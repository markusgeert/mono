import {expect} from '@esm-bundle/chai';
import * as dag from '../dag/mod';
import * as db from '../db/mod';
import {assertHash, makeNewFakeHashFunction} from '../hash';
import {GatherVisitor} from './gather-visitor';
import type {JSONObject} from '../json';
import {ChainBuilder} from '../db/test-helpers.js';

test('dag with no memory-only hashes gathers nothing', async () => {
  const clientID = 'client-id';
  const hashFunction = makeNewFakeHashFunction();
  const perdag = new dag.TestStore(undefined, hashFunction);
  const memdag = new dag.LazyStore(
    perdag,
    100 * 2 ** 20, // 100 MB,
    hashFunction,
    assertHash,
  );

  const pb = new ChainBuilder(perdag);
  await pb.addGenesis(clientID);
  await pb.addLocal(clientID);
  if (!DD31) {
    await pb.addIndexChange(clientID);
  }
  await pb.addLocal(clientID);

  await memdag.withRead(async dagRead => {
    for (const commit of pb.chain) {
      const visitor = new GatherVisitor(dagRead);
      await visitor.visitCommit(commit.chunk.hash);
      expect(visitor.gatheredChunks).to.be.empty;
    }
  });

  await pb.addSnapshot(undefined, clientID);

  await memdag.withRead(async dagRead => {
    const visitor = new GatherVisitor(dagRead);
    await visitor.visitCommit(pb.headHash);
    expect(visitor.gatheredChunks).to.be.empty;
  });
});

test('dag with only temp hashes gathers everything', async () => {
  const clientID = 'client-id';
  const hashFunction = makeNewFakeHashFunction();
  const perdag = new dag.TestStore(undefined, hashFunction);
  const memdag = new dag.LazyStore(
    perdag,
    100 * 2 ** 20, // 100 MB,
    hashFunction,
    assertHash,
  );

  const mb = new ChainBuilder(memdag);

  const testGatheredChunks = async () => {
    await memdag.withRead(async dagRead => {
      const visitor = new GatherVisitor(dagRead);
      await visitor.visitCommit(mb.headHash);
      expect(memdag.getMemOnlyChunksSnapshot()).to.deep.equal(
        visitor.gatheredChunks,
      );
    });
  };

  await mb.addGenesis(clientID);
  await mb.addLocal(clientID);
  await testGatheredChunks();

  if (!DD31) {
    await mb.addIndexChange(clientID);
  }
  await mb.addLocal(clientID);
  await testGatheredChunks();

  await mb.addSnapshot(undefined, clientID);
  await testGatheredChunks();
});

test('dag with some permanent hashes and some memory-only hashes on top', async () => {
  const clientID = 'client-id';
  const hashFunction = makeNewFakeHashFunction();
  const perdag = new dag.TestStore(undefined, hashFunction);
  const memdag = new dag.LazyStore(
    perdag,
    100 * 2 ** 20, // 100 MB,
    hashFunction,
    assertHash,
  );

  const pb = new ChainBuilder(perdag);
  const mb = new ChainBuilder(memdag);

  await pb.addGenesis(clientID);
  await pb.addLocal(clientID);

  await memdag.withWrite(async memdagWrite => {
    await memdagWrite.setHead(db.DEFAULT_HEAD_NAME, pb.headHash);
    await memdagWrite.commit();
  });
  mb.chain = pb.chain.slice();
  await mb.addLocal(clientID);

  await memdag.withRead(async dagRead => {
    const visitor = new GatherVisitor(dagRead);
    await visitor.visitCommit(mb.headHash);
    const meta: JSONObject = {
      basisHash: 'face0000-0000-4000-8000-000000000003',
      mutationID: 2,
      mutatorArgsJSON: [2],
      mutatorName: 'mutator_name_2',
      originalHash: null,
      timestamp: 42,
      type: 2,
    };
    if (DD31) {
      meta.clientID = clientID;
    }
    expect(Object.fromEntries(visitor.gatheredChunks)).to.deep.equal({
      'face0000-0000-4000-8000-000000000004': {
        data: [0, [['local', '2']]],
        hash: 'face0000-0000-4000-8000-000000000004',
        meta: [],
      },
      'face0000-0000-4000-8000-000000000005': {
        data: {
          indexes: [],
          meta,
          valueHash: 'face0000-0000-4000-8000-000000000004',
        },
        hash: 'face0000-0000-4000-8000-000000000005',
        meta: [
          'face0000-0000-4000-8000-000000000004',
          'face0000-0000-4000-8000-000000000003',
        ],
      },
    });
  });
});

test('dag with some permanent hashes and some memory-only hashes on top w index', async () => {
  const clientID = 'client-id';
  const hashFunction = makeNewFakeHashFunction();
  const perdag = new dag.TestStore(undefined, hashFunction);
  const memdag = new dag.LazyStore(
    perdag,
    100 * 2 ** 20, // 100 MB,
    hashFunction,
    assertHash,
  );

  const mb = new ChainBuilder(memdag);
  const pb = new ChainBuilder(perdag);

  await pb.addGenesis(clientID);

  await pb.addSnapshot(
    Object.entries({
      a: 1,
      b: {name: 'b-name'},
    }),
    clientID,
    undefined,
    undefined,
    {testIndex: {prefix: '', jsonPointer: '/name', allowEmpty: true}},
  );
  await memdag.withWrite(async memdagWrite => {
    await memdagWrite.setHead(db.DEFAULT_HEAD_NAME, pb.headHash);
    await memdagWrite.commit();
  });

  mb.chain = pb.chain.slice();
  if (DD31) {
    await mb.addLocal(clientID, [['c', {name: 'c-name'}]]);
  } else {
    await mb.addIndexChange(clientID, 'testIndex', {
      prefix: '',
      jsonPointer: '/name',
      allowEmpty: true,
    });
    await mb.addLocal(clientID, [['c', {name: 'c-name'}]]);
  }

  await memdag.withRead(async dagRead => {
    const visitor = new GatherVisitor(dagRead);
    await visitor.visitCommit(mb.headHash);
    expect(Object.fromEntries(visitor.gatheredChunks)).to.deep.equal(
      DD31
        ? {
            'face0000-0000-4000-8000-000000000008': {
              hash: 'face0000-0000-4000-8000-000000000008',
              data: {
                meta: {
                  type: 2,
                  basisHash: 'face0000-0000-4000-8000-000000000005',
                  mutationID: 2,
                  mutatorName: 'mutator_name_2',
                  mutatorArgsJSON: [2],
                  originalHash: null,
                  timestamp: 42,
                  clientID: 'client-id',
                },
                valueHash: 'face0000-0000-4000-8000-000000000006',
                indexes: [
                  {
                    definition: {
                      name: 'testIndex',
                      keyPrefix: '',
                      jsonPointer: '/name',
                      allowEmpty: true,
                    },
                    valueHash: 'face0000-0000-4000-8000-000000000007',
                  },
                ],
              },
              meta: [
                'face0000-0000-4000-8000-000000000006',
                'face0000-0000-4000-8000-000000000005',
                'face0000-0000-4000-8000-000000000007',
              ],
            },
            'face0000-0000-4000-8000-000000000006': {
              hash: 'face0000-0000-4000-8000-000000000006',
              data: [
                0,
                [
                  ['a', 1],
                  [
                    'b',
                    {
                      name: 'b-name',
                    },
                  ],
                  [
                    'c',
                    {
                      name: 'c-name',
                    },
                  ],
                ],
              ],
              meta: [],
            },
            'face0000-0000-4000-8000-000000000007': {
              hash: 'face0000-0000-4000-8000-000000000007',
              data: [
                0,
                [
                  [
                    '\u0000b-name\u0000b',
                    {
                      name: 'b-name',
                    },
                  ],
                  [
                    '\u0000c-name\u0000c',
                    {
                      name: 'c-name',
                    },
                  ],
                ],
              ],
              meta: [],
            },
          }
        : {
            'face0000-0000-4000-8000-000000000008': {
              hash: 'face0000-0000-4000-8000-000000000008',
              data: {
                meta: {
                  type: 2,
                  basisHash: 'face0000-0000-4000-8000-000000000005',
                  mutationID: 2,
                  mutatorName: 'mutator_name_3',
                  mutatorArgsJSON: [3],
                  originalHash: null,
                  timestamp: 42,
                },
                valueHash: 'face0000-0000-4000-8000-000000000006',
                indexes: [
                  {
                    definition: {
                      name: 'testIndex',
                      keyPrefix: '',
                      jsonPointer: '/name',
                      allowEmpty: true,
                    },
                    valueHash: 'face0000-0000-4000-8000-000000000007',
                  },
                ],
              },
              meta: [
                'face0000-0000-4000-8000-000000000006',
                'face0000-0000-4000-8000-000000000005',
                'face0000-0000-4000-8000-000000000007',
              ],
            },
            'face0000-0000-4000-8000-000000000005': {
              hash: 'face0000-0000-4000-8000-000000000005',
              data: {
                meta: {
                  type: 1,
                  basisHash: 'face0000-0000-4000-8000-000000000003',
                  lastMutationID: 1,
                },
                valueHash: 'face0000-0000-4000-8000-000000000002',
                indexes: [
                  {
                    definition: {
                      name: 'testIndex',
                      keyPrefix: '',
                      jsonPointer: '/name',
                      allowEmpty: true,
                    },
                    valueHash: 'face0000-0000-4000-8000-000000000004',
                  },
                ],
              },
              meta: [
                'face0000-0000-4000-8000-000000000002',
                'face0000-0000-4000-8000-000000000003',
                'face0000-0000-4000-8000-000000000004',
              ],
            },
            'face0000-0000-4000-8000-000000000006': {
              hash: 'face0000-0000-4000-8000-000000000006',
              data: [
                0,
                [
                  ['a', 1],
                  [
                    'b',
                    {
                      name: 'b-name',
                    },
                  ],
                  [
                    'c',
                    {
                      name: 'c-name',
                    },
                  ],
                ],
              ],
              meta: [],
            },
            'face0000-0000-4000-8000-000000000007': {
              hash: 'face0000-0000-4000-8000-000000000007',
              data: [
                0,
                [
                  [
                    '\u0000b-name\u0000b',
                    {
                      name: 'b-name',
                    },
                  ],
                  [
                    '\u0000c-name\u0000c',
                    {
                      name: 'c-name',
                    },
                  ],
                ],
              ],
              meta: [],
            },
            'face0000-0000-4000-8000-000000000004': {
              hash: 'face0000-0000-4000-8000-000000000004',
              data: [
                0,
                [
                  [
                    '\u0000b-name\u0000b',
                    {
                      name: 'b-name',
                    },
                  ],
                ],
              ],
              meta: [],
            },
          },
    );
  });
});
