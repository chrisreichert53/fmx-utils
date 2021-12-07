import axios from 'axios';
import { groupBy, find, countBy, pick, invert } from 'lodash';
import flat, { unflatten } from 'flat';
import inquirer from 'inquirer';
import Q from 'q';
import dotenv from 'dotenv';
import XLSX from 'xlsx';

(async () => {
  dotenv.config();

  // Environment Variables
  const {
    URL,
    USERNAME,
    PASSWORD,
    FILE_PATH,
    SHEET_BUILDING_FIELD,
    SHEET_TAG_FIELD,
    SHEET_TYPE_FIELD,
    SHEET_ID_FIELD,
    SHEET_LOCATION_FIELD,
  } = process.env;

  // Open the excel sheet
  const wb: XLSX.WorkBook = XLSX.readFile(FILE_PATH);
  const contents: object[] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  // Configure the standard axios request
  const request = axios.create({
    baseURL: `https://${URL}/api/v1`,
    auth: {
      username: USERNAME,
      password: PASSWORD,
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
  console.log(SHEET_BUILDING_FIELD);
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
  const toBeChanged = contents.filter((item) =>
    find(buildings, { name: item[SHEET_BUILDING_FIELD] })
  );

  // Generate the PUT body changes. Must include the id
  let changes: Array<any> = toBeChanged.map((change: object) => {
    const id = change[SHEET_ID_FIELD];
    const tag = change[SHEET_TAG_FIELD];
    const buildingID = siteBuildingIDs[change[SHEET_BUILDING_FIELD]];
    const equipmentTypeID = equipmentTypeIDs[change[SHEET_TYPE_FIELD]];
    const locationResourceID =
      siteLocationIDs[`${change[SHEET_LOCATION_FIELD]} (${change[SHEET_BUILDING_FIELD]})`];

    let payload = {
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

  // The possible fields to be included in the update.
  const possibleFields = Object.keys(changes[0])
    .filter(
      (key) =>
        (!key.startsWith('customFields') && key != 'id') ||
        (key.startsWith('customFields') && key.endsWith('name'))
    )
    .map((key) =>
      key.startsWith('customFields')
        ? {
            name: changes[0][key],
            value: key,
          }
        : {
            name: key,
            value: key,
          }
    )
    .sort();

  let { included } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'included',
      message: 'Which fields would you like to include in the update?',
      choices: [{ name: 'all', value: 'all' }].concat(possibleFields),
      default: ['tag', 'buildingID', 'equipmentTypeID'],
    },
  ]);
  included = included.includes('all') ? possibleFields : included;

  // Final list of changes
  changes = changes
    .map((change: object) =>
      unflatten(
        pick(
          change,
          ['id'].concat(included).reduce((acc, key) => {
            acc.push(key);
            if (key.startsWith('customFields')) {
              acc.push(key.replace('.name', '.value'));
              acc.push(key.replace('.name', '.id'));
            }
            return acc;
          }, [])
        )
      )
    )
    .map((change: any) => ({
      ...change,
      customFields: (change.customFields || [])
        .filter((field: any) => !!field)
        .map(({ id, value }) => ({
          customFieldID: id,
          value,
        })),
    }));

  // PUT all changes
  let results = await Q.allSettled(
    changes.map((change: any) => request.put(`/equipment/${change.id}`, change))
  );

  // Change results
  let simpleResults = results.map(({ state, value, reason }) => ({
    state,
    value: pick(value, ['status', 'data']),
    reason,
  }));

  // Display the resulting success/fail counts
  console.log(
    simpleResults.reduce(
      (acc, res) => ({
        success: acc.success + (res.state === 'fulfilled' ? 1 : 0),
        fail: acc.fail + (res.state === 'fulfilled' ? 0 : 1),
        failures: res.state === 'rejected' ? acc.failures.concat([res.reason]) : acc.failures,
      }),
      { success: 0, fail: 0, failures: [] }
    )
  );
})();
