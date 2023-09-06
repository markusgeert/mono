import {expect, test} from '@jest/globals';
import {DataConverter} from './converter.js';
import {DeploymentSpec, deploymentSpecSchema} from './deployment.js';
import type {
  DocumentData,
  QueryDocumentSnapshot,
} from '@google-cloud/firestore';
import {dummySecrets} from './test-helpers.js';

// Replicates the internal validation performed in the Firestore libraries
// that ensure that data confirms to certain expectations:
// https://github.com/googleapis/nodejs-firestore/blob/d2b97c4e041ca6f3245b942540e793d429f8e5c5/dev/src/util.ts#L107
function isObject(value: unknown): value is {[k: string]: unknown} {
  return Object.prototype.toString.call(value) === '[object Object]';
}

function isPlainObject(input: unknown): input is object {
  return (
    isObject(input) &&
    (Object.getPrototypeOf(input) === Object.prototype ||
      Object.getPrototypeOf(input) === null ||
      input.constructor.name === 'Object')
  );
}

function isValidDocumentData(input: object): boolean {
  for (const [name, value] of Object.entries(input)) {
    console.info(`Checking ${name}`, value);
    if (isPlainObject(value) && !isValidDocumentData(value)) {
      return false;
    }
  }
  return true;
}

test('converter creates plain objects', () => {
  const converter = new DataConverter(deploymentSpecSchema);

  function convert(obj: DocumentData): DeploymentSpec {
    const snapshot = {
      data: () => obj,
    } as QueryDocumentSnapshot<DocumentData>;
    return converter.fromFirestore(snapshot);
  }

  const parsed = convert({
    appModules: [],
    serverVersionRange: 'foo',
    serverVersion: 'bar',
    hostname: 'baz',
    hashesOfSecrets: dummySecrets(),
    options: {vars: {}},
  });

  expect(isValidDocumentData(parsed));

  /* eslint-disable @typescript-eslint/naming-convention */
  expect(parsed).toEqual({
    appModules: [],
    serverVersionRange: 'foo',
    serverVersion: 'bar',
    hostname: 'baz',
    hashesOfSecrets: dummySecrets(),
    options: {
      vars: {
        DISABLE: 'false',
        DISABLE_LOG_FILTERING: 'false',
        LOG_LEVEL: 'info',
      },
    },
  });
  /* eslint-enable @typescript-eslint/naming-convention */
});