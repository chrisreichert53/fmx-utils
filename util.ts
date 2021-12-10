import { AxiosResponse } from 'axios';
import { pick } from 'lodash';
import { unflatten } from 'flat';
import inquirer from 'inquirer';
import Q from 'q';

export const possibleFields = (change: any) => {
  return Object.keys(change)
    .filter(
      (key) =>
        ((!key.startsWith('customFields') && key != 'id') ||
          (key.startsWith('customFields') && key.endsWith('name'))) &&
        change[key] !== 'Location' &&
        key !== '_row' &&
        key !== '_id'
    )
    .map((key) =>
      key.startsWith('customFields')
        ? {
            name: change[key],
            value: key,
          }
        : {
            name: key,
            value: key,
          }
    )
    .sort();
};

export const createChangeSet = async (changes: Array<any>, type: 'update' | 'upload') => {
  // The possible fields to be included in the update.
  let fields = possibleFields(changes[0]);
  let { included } = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'included',
      message: `Which fields would you like to include in the ${type}?`,
      choices: [{ name: 'all', value: 'all' }].concat(fields),
      default: ['tag', 'buildingID', 'equipmentTypeID'],
    },
  ]);
  included = included.includes('all') ? fields.map(({ value }) => value) : included;

  // Final list of changes
  return changes
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
};

export const formatResults = (results: Q.PromiseState<AxiosResponse<any>>[]) => {
  // Change results
  let simpleResults = results.map(({ state, value, reason }) => ({
    state,
    value: pick(value, ['status', 'data']),
    reason,
  }));

  // Display the resulting success/fail counts
  const finalResults = simpleResults.reduce(
    (acc, res) => ({
      success: acc.success + (res.state === 'fulfilled' ? 1 : 0),
      fail: acc.fail + (res.state === 'fulfilled' ? 0 : 1),
      failures:
        res.state === 'rejected'
          ? acc.failures.concat([
              {
                status: res.reason.response.status,
                config: JSON.stringify(res.reason.response.config, null, 2),
                data: JSON.stringify(res.reason.response.data, null, 2),
              },
            ])
          : acc.failures,
    }),
    { success: 0, fail: 0, failures: [] }
  );

  return finalResults;
};
