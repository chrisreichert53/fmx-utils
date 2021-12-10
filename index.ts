import axios from 'axios';
import { groupBy, find, countBy, pick, invert, last } from 'lodash';
import flat from 'flat';
import inquirer from 'inquirer';
import Q from 'q';
import dotenv from 'dotenv';
import XLSX from 'xlsx';

import { formatResults, createChangeSet } from './util';

(async () => {
  dotenv.config();

  // Environment Variables
  const {
    URL,
    FMX_USERNAME,
    FMX_PASSWORD,
    FILE_PATH,
    SHEET_BUILDING_FIELD,
    SHEET_TAG_FIELD,
    SHEET_TYPE_FIELD,
    SHEET_ID_FIELD,
    SHEET_LOCATION_FIELD,
  } = process.env;

  // Open the excel sheet
  const wb: XLSX.WorkBook = XLSX.readFile(FILE_PATH, {
    cellNF: true,
    cellStyles: true,
    cellDates: true,
  });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const contents: object[] = XLSX.utils
    .sheet_to_json(sheet)
    .map((rowContent: object, i) => ({ ...rowContent, _row: i + 2, _id: rowContent['UniqueID'] }));

  // Configure the standard axios request
  const request = axios.create({
    baseURL: `https://${URL}/api/v1`,
    auth: {
      username: FMX_USERNAME,
      password: FMX_PASSWORD,
    },
  });

  // const siteBuildings = await (await request.get('/buildings?fields=id%2Cname')).data;
  const siteEquipmentOptions = await (await request.get('/equipment/get-options')).data;
  const siteBuildingIDs = invert(siteEquipmentOptions.buildings);
  const equipmentTypeIDs = invert(siteEquipmentOptions.equipmentTypes);
  const siteLocationIDs = invert(siteEquipmentOptions.resources);
  const customFieldIDs = invert({
    ...siteEquipmentOptions.sortKeys,
    ...siteEquipmentOptions.customFields,
  });

  // Get the list of buildings that is included in the edit sheet
  const sheetBuildings = Object.keys(groupBy(contents, SHEET_BUILDING_FIELD))
    .sort()
    .map((bldg) => {
      return siteBuildingIDs[bldg]
        ? {
            name: bldg,
            id: siteBuildingIDs[bldg],
          }
        : null;
    })
    .filter((bldg) => !!bldg);

  // Get from the edit sheet, how many items are included for each building
  const counts = countBy(contents, (obj) => obj[SHEET_BUILDING_FIELD]);

  // Ask the user which buildings they would like to include
  let { buildings } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'buildings',
      message: 'Which buildings would you like to update?',
      choices: [{ name: '- ALL BUILDINGS -', value: { name: 'all' } }].concat(
        sheetBuildings.map((bldg) => ({
          name: `${bldg.name} (${counts[bldg.name]})`,
          value: bldg,
        }))
      ),
    },
  ]);
  buildings = find(buildings, { name: 'all' }) ? sheetBuildings : buildings;

  // The updated list of items based on the buildings choice
  const toBeChanged = contents.filter((item) => find(buildings, { name: item[SHEET_BUILDING_FIELD] }));

  // Generate the PUT body changes. Must include the id
  let buildingEquipment: Array<any> = toBeChanged.map((change: object, i: number) => {
    const _row = change['_row'];
    const id = change[SHEET_ID_FIELD];
    const tag = change[SHEET_TAG_FIELD];
    const buildingID = siteBuildingIDs[change[SHEET_BUILDING_FIELD]];
    const equipmentTypeID = equipmentTypeIDs[change[SHEET_TYPE_FIELD]];
    const locationResourceID = siteLocationIDs[`${change[SHEET_LOCATION_FIELD]} (${change[SHEET_BUILDING_FIELD]})`];

    let payload = {
      _row,
      id,
      tag,
      buildingID,
      equipmentTypeID,
      locationResourceID,
      customFields: [],
    };

    payload.customFields = Object.keys(customFieldIDs).reduce((acc, key) => {
      if (key in change) {
        acc.push({
          id: customFieldIDs[key],
          value: change[key],
          name: key,
        });
      }
      return acc;
    }, []);

    return flat(payload);
  });

  buildingEquipment = [buildingEquipment[0], last(buildingEquipment)];

  const oldEquipment = await createChangeSet(
    buildingEquipment.filter((change: any) => change.id),
    'update'
  );

  // PUT all old equipment updates
  let results = await Q.allSettled(oldEquipment.map((change: any) => request.put(`/equipment/${change.id}`, change)));

  const notCreatedEquipment = buildingEquipment.length - oldEquipment.length;
  console.log(
    JSON.stringify(
      {
        ...formatResults(results),
        notCreated: notCreatedEquipment,
      },
      null,
      2
    )
  );

  if (notCreatedEquipment > 0) {
    const { addEquipment } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'addEquipment',
        message: `Would you like to add (${notCreatedEquipment}) items?`,
        default: false,
      },
    ]);

    if (addEquipment) {
      let newEquipment = await createChangeSet(
        buildingEquipment.filter((change: any) => !change.id),
        'upload'
      );
      newEquipment = newEquipment.map((change: any) => {
        delete change.id;
        return change;
      });

      let range = XLSX.utils.decode_range(sheet['!ref']);
      for (let rowNum = range.s.r; rowNum <= range.e.r; rowNum++) {
        var nextCell = XLSX.utils.encode_cell({ r: rowNum, c: 2 });
        // var value = sheet[nextCell].v;
        if (nextCell === 'C235') {
          sheet[nextCell].v = 1;
        }
      }
      XLSX.writeFile(wb, FILE_PATH);

      // POST all new equipment
      // results = await Q.allSettled(
      //   newEquipment.map((change: any) => request.post(`/equipment`, change))
      // );

      // console.log(JSON.stringify(formatResults(results)));
    }
  }
})();
