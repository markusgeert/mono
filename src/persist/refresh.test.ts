import {expect} from '@esm-bundle/chai';
import {LogContext} from '@rocicorp/logger';
import type * as sync from '../sync/mod.js';
import * as dag from '../dag/mod.js';
import * as db from '../db/mod.js';
import * as btree from '../btree/mod.js';
import {ChainBuilder} from '../db/test-helpers.js';
import {assertHash, Hash, makeNewFakeHashFunction} from '../hash.js';
import {JSONValue, ReadonlyJSONValue, deepFreeze} from '../json.js';
import {
  ClientGroupMap,
  setClientGroup,
  setClientGroups,
} from '../persist/client-groups.js';
import {ClientDD31, setClient} from '../persist/clients.js';
import {addData, testSubscriptionsManagerOptions} from '../test-util.js';
import {refresh} from './refresh.js';
import {assert, assertNotUndefined} from '../asserts.js';
import type {MutatorDefs} from '../replicache.js';
import type {WriteTransaction} from '../transactions.js';
import type {Cookie} from '../cookies.js';
import {withRead, withWrite} from '../with-transactions.js';

async function makeChain(
  store: dag.Store,
  clientID: sync.ClientID,
  cookie: number,
  headName: string,
  withLocal = true,
): Promise<{headHash: Hash; chainBuilder: ChainBuilder}> {
  const chainBuilder: ChainBuilder = new ChainBuilder(store, headName);
  await chainBuilder.addGenesis(clientID);
  await chainBuilder.addSnapshot([], clientID, cookie);
  if (withLocal) {
    await chainBuilder.addLocal(clientID, []);
  }
  const headHash = chainBuilder.chain.at(-1)?.chunk.hash;
  assertNotUndefined(headHash);
  return {headHash, chainBuilder};
}

function makeMemdagChain(
  memdag: dag.Store,
  clientID: sync.ClientID,
  cookie: number,
): Promise<{headHash: Hash; chainBuilder: ChainBuilder}> {
  return makeChain(memdag, clientID, cookie, db.DEFAULT_HEAD_NAME);
}

const PERDAG_TEST_SETUP_HEAD_NAME = 'test-setup-head';
async function makePerdagChainAndSetClientsAndClientGroup(
  perdag: dag.Store,
  clientID: sync.ClientID,
  cookie: number,
  withLocal = true,
): Promise<{headHash: Hash; chainBuilder: ChainBuilder}> {
  const {headHash, chainBuilder} = await makeChain(
    perdag,
    clientID,
    cookie,
    PERDAG_TEST_SETUP_HEAD_NAME,
    withLocal,
  );
  await setClientsAndClientGroups(headHash, clientID, perdag);
  return {headHash, chainBuilder};
}

async function setClientsAndClientGroups(
  headHash: Hash,
  clientID: sync.ClientID,
  perdag: dag.Store,
) {
  const clientGroupID = 'client-group-1';
  const clientGroups: ClientGroupMap = new Map([
    [
      clientGroupID,
      {
        headHash,
        indexes: {},
        // Not used
        mutationIDs: {[clientID]: -1},
        // Not used
        lastServerAckdMutationIDs: {[clientID]: -1},
        mutatorNames: [],
        disabled: false,
      },
    ],
  ]);

  const client: ClientDD31 = {
    clientGroupID,
    headHash,
    // Not used
    heartbeatTimestampMs: -1,
    tempRefreshHash: null,
  };

  await withWrite(perdag, async perdagWrite => {
    await setClientGroups(clientGroups, perdagWrite);
    await setClient(clientID, client, perdagWrite);
    await perdagWrite.removeHead(PERDAG_TEST_SETUP_HEAD_NAME);
    await perdagWrite.commit();
  });
}

function makeStores() {
  const LAZY_STORE_SOURCE_CHUNK_CACHE_SIZE_LIMIT = 10 * 2 ** 20; // 10 MB
  const chunkHasher = makeNewFakeHashFunction();
  const perdag = new dag.TestStore(undefined, chunkHasher);
  const memdag = new dag.LazyStore(
    perdag,
    LAZY_STORE_SOURCE_CHUNK_CACHE_SIZE_LIMIT,
    chunkHasher,
    assertHash,
  );
  return {perdag, memdag};
}

function mutatorsProxy(): MutatorDefs {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        return async (tx: WriteTransaction, args: JSONValue) => {
          await tx.put(`from ${String(prop)}`, args);
        };
      },
    },
  );
}

suite('refresh', () => {
  test('identical dags', async () => {
    // If the dags are the same then refresh is a no op.
    const {perdag, memdag} = makeStores();
    const clientID = 'client-id-1';
    const mutators = mutatorsProxy();

    await makePerdagChainAndSetClientsAndClientGroup(perdag, clientID, 1);
    await makeMemdagChain(memdag, clientID, 1);

    const result = await refresh(
      new LogContext(),
      memdag,
      perdag,
      clientID,
      mutators,
      testSubscriptionsManagerOptions,
      () => false,
    );
    assert(result);
    expect(result[0]).to.deep.equal(
      await withRead(memdag, read => read.getHead(db.DEFAULT_HEAD_NAME)),
    );
    expect(Object.fromEntries(result[1])).to.deep.equal({});
  });

  test('memdag has one more LM', async () => {
    const {perdag, memdag} = makeStores();
    const clientID = 'client-id-1';
    const mutators: MutatorDefs = mutatorsProxy();

    await makePerdagChainAndSetClientsAndClientGroup(perdag, clientID, 1);

    // Memdag has one more LM than perdag.
    const {chainBuilder: memdagChainBuilder} = await makeMemdagChain(
      memdag,
      clientID,
      1,
    );
    await memdagChainBuilder.addLocal(clientID, []);

    const result = await refresh(
      new LogContext(),
      memdag,
      perdag,
      clientID,
      mutators,
      testSubscriptionsManagerOptions,
      () => false,
    );
    assert(result);
    expect(result[0]).to.deep.equal(
      await withRead(memdag, read => read.getHead(db.DEFAULT_HEAD_NAME)),
    );
    expect(Object.fromEntries(result[1])).to.deep.equal({
      '': [
        {
          key: 'from mutator_name_3',
          newValue: [3],
          op: 'add',
        },
      ],
    });
  });

  test('memdag has a newer cookie', async () => {
    const {perdag, memdag} = makeStores();
    const clientID = 'client-id-1';
    const mutators: MutatorDefs = mutatorsProxy();

    await makePerdagChainAndSetClientsAndClientGroup(perdag, clientID, 1);

    // Memdag has a newer cookie than perdag so we abort the refresh
    const {chainBuilder: memdagChainBuilder} = await makeMemdagChain(
      memdag,
      clientID,
      2,
    );
    // Memdag has one more LM than perdag.
    await memdagChainBuilder.addLocal(clientID, []);

    const diffs = await refresh(
      new LogContext(),
      memdag,
      perdag,
      clientID,
      mutators,
      testSubscriptionsManagerOptions,
      () => false,
    );
    expect(diffs).undefined;
  });

  test('cookies are equal and perdag has no LM', async () => {
    const {perdag, memdag} = makeStores();
    const clientID = 'client-id-1';
    const mutators: MutatorDefs = mutatorsProxy();

    await makePerdagChainAndSetClientsAndClientGroup(
      perdag,
      clientID,
      1,
      false,
    );

    // Memdag has same cookie as perdag, and perdag has no
    // LM so we abort the refresh
    await makeMemdagChain(memdag, clientID, 1);

    const diffs = await refresh(
      new LogContext(),
      memdag,
      perdag,
      clientID,
      mutators,
      testSubscriptionsManagerOptions,
      () => false,
    );
    expect(diffs).undefined;
  });

  test('memdag has two more LMs', async () => {
    const {perdag, memdag} = makeStores();
    const clientID = 'client-id-1';
    const mutators: MutatorDefs = mutatorsProxy();

    await makePerdagChainAndSetClientsAndClientGroup(perdag, clientID, 1);

    // Memdag has two more LM than perdag.
    const {chainBuilder: memdagChainBuilder} = await makeMemdagChain(
      memdag,
      clientID,
      1,
    );
    await memdagChainBuilder.addLocal(clientID, []);
    await memdagChainBuilder.addLocal(clientID, []);

    const result = await refresh(
      new LogContext(),
      memdag,
      perdag,
      clientID,
      mutators,
      testSubscriptionsManagerOptions,
      () => false,
    );
    assert(result);
    expect(result[0]).to.deep.equal(
      await withRead(memdag, read => read.getHead(db.DEFAULT_HEAD_NAME)),
    );
    expect(Object.fromEntries(result[1])).to.deep.equal({
      '': [
        {
          key: 'from mutator_name_3',
          newValue: [3],
          op: 'add',
        },
        {
          key: 'from mutator_name_4',
          newValue: [4],
          op: 'add',
        },
      ],
    });
  });

  test('perdag has LM from different clients', async () => {
    const {perdag, memdag} = makeStores();
    const clientID1 = 'client-id-1';
    const clientID2 = 'client-id-2';

    const mutators: MutatorDefs = mutatorsProxy();

    const perdagChainBuilder: ChainBuilder = new ChainBuilder(
      perdag,
      PERDAG_TEST_SETUP_HEAD_NAME,
    );
    await perdagChainBuilder.addGenesis(clientID1);
    await perdagChainBuilder.addSnapshot([], clientID1, 1, {
      [clientID1]: 0,
      [clientID2]: 0,
    });
    await perdagChainBuilder.addLocal(clientID1, []);
    const perdagHeadCommit = await perdagChainBuilder.addLocal(clientID2, []);
    const perdagHeadHash = perdagHeadCommit.chunk.hash;
    await setClientsAndClientGroups(perdagHeadHash, clientID1, perdag);

    const memdagChainBuilder: ChainBuilder = new ChainBuilder(
      memdag,
      db.DEFAULT_HEAD_NAME,
    );
    await memdagChainBuilder.addGenesis(clientID1);
    await memdagChainBuilder.addSnapshot([], clientID1, 1, {
      [clientID1]: 0,
      [clientID2]: 0,
    });
    await memdagChainBuilder.addLocal(clientID1, []);
    await memdagChainBuilder.addLocal(clientID1, []);

    const result = await refresh(
      new LogContext(),
      memdag,
      perdag,
      clientID1,
      mutators,
      testSubscriptionsManagerOptions,
      () => false,
    );
    assert(result);
    expect(result[0]).to.deep.equal(
      await withRead(memdag, read => read.getHead(db.DEFAULT_HEAD_NAME)),
    );
    expect(Object.fromEntries(result[1])).to.deep.equal({
      '': [
        {
          key: 'from mutator_name_3',
          newValue: [3],
          op: 'add',
        },
      ],
    });
  });

  test('new snapshot during refresh', async () => {
    const {perdag, memdag} = makeStores();
    const clientID = 'client-id-1';
    const mutators: MutatorDefs = mutatorsProxy();

    await makePerdagChainAndSetClientsAndClientGroup(perdag, clientID, 2);

    // Memdag has one more LM than perdag.
    const {chainBuilder: memdagChainBuilder} = await makeMemdagChain(
      memdag,
      clientID,
      2,
    );
    await memdagChainBuilder.addLocal(clientID, []);

    // Here we use a brittle way to inject a snapshot in the middle of the refresh
    // algorithm.
    let writeCalls = 0;
    const {write} = perdag;
    perdag.write = async () => {
      if (writeCalls++ === 0) {
        await memdagChainBuilder.addSnapshot([], clientID, 3);
        await memdagChainBuilder.addLocal(clientID, []);
      }
      return write.call(perdag);
    };

    const diffs = await refresh(
      new LogContext(),
      memdag,
      perdag,
      clientID,
      mutators,
      testSubscriptionsManagerOptions,
      () => false,
    );
    expect(diffs).undefined;
  });

  test('greg example', async () => {
    // This sample case was used by Greg to explain DD31 refresh to arv. Here is
    // an extract of that explanation (from Slack)
    //
    // We update the memdags head to the head of the perdag client group The
    // perdag client group may look like
    //
    // perdag:mainHead -> LM {clientID: 1 id: 4 } -> LM {clientID: 2 id: 3 } ->
    // Snapshot { lmids: { 1: 3, 2: 2} }
    //
    // so then lets say client 1 is refreshing and his memdag looks like
    //
    // memdag:main -> LM {clientID: 1 id: 5 }  -> LM {clientID: 1 id: 4 }  ->
    // Snapshot { lmids: { 1: 3, 2: 2} }
    //
    // we create a refresh head
    //
    // medag:refresh = perdag:mainHead, so
    //
    // memdag:refresh -> LM {clientID: 1 id: 4 } -> LM {clientID: 2 id: 3 } ->
    // Snapshot { lmids: { 1: 3, 2: 2} }
    //
    // then we rebase from memdag main any mutations not on refreshHead
    //
    // medag:refresh -> LM {clientID: 1 id: 5 } -> LM {clientID: 1 id: 4 } -> LM
    // {clientID: 2 id: 3 } -> Snapshot { lmids: { 1: 3, 2: 2} }
    //
    // then we set
    //
    // medag:main = medag:refresh
    //
    // medag:main -> LM {clientID: 1 id: 5 } -> LM {clientID: 1 id: 4 } -> LM
    // {clientID: 2 id: 3 } -> Snapshot { lmids: { 1: 3, 2: 2} }

    const {perdag, memdag} = makeStores();

    async function makeSnapshot({
      store,
      basisHash = null,
      lastMutationIDs,
      cookieJSON,
      valueHash,
      indexes = [],
    }: {
      store: dag.Store;
      basisHash?: Hash | null;
      lastMutationIDs: Record<sync.ClientID, number>;
      cookieJSON: Cookie;
      valueHash?: Hash;
      indexes?: db.IndexRecord[];
    }): Promise<db.Commit<db.SnapshotMetaDD31>> {
      return await withWrite(store, async dagWrite => {
        if (!valueHash) {
          const map = new btree.BTreeWrite(dagWrite);
          valueHash = await map.flush();
        }
        const c = db.newSnapshotDD31(
          dagWrite.createChunk,
          basisHash,
          lastMutationIDs,
          deepFreeze(cookieJSON),
          valueHash,
          indexes,
        );

        await dagWrite.putChunk(c.chunk);
        await dagWrite.setHead('test', c.chunk.hash);
        await dagWrite.commit();

        return c;
      });
    }

    let timestampCounter = 0;

    async function makeLocalMutation({
      store,
      clientID,
      mutationID,
      basisHash,
      mutatorName,
      mutatorArgsJSON,
      originalHash = null,
      indexes = [],
      valueHash,
      timestamp = timestampCounter++,
      entries = [],
    }: {
      store: dag.Store;
      clientID: sync.ClientID;
      mutationID: number;
      basisHash: Hash;
      mutatorName: string;
      mutatorArgsJSON: JSONValue;
      originalHash?: Hash | null;
      indexes?: readonly db.IndexRecord[];
      valueHash: Hash;
      timestamp?: number;
      entries?: readonly btree.Entry<ReadonlyJSONValue>[];
    }): Promise<db.Commit<db.LocalMetaDD31>> {
      return await withWrite(store, async dagWrite => {
        const m = new btree.BTreeWrite(dagWrite, valueHash);
        for (const [k, v] of entries) {
          await m.put(k, deepFreeze(v));
        }
        const newValueHash = await m.flush();

        const c = db.newLocalDD31(
          dagWrite.createChunk,
          basisHash,
          await db.baseSnapshotHashFromHash(basisHash, dagWrite),
          mutationID,
          mutatorName,
          deepFreeze(mutatorArgsJSON),
          originalHash,
          newValueHash,
          indexes,
          timestamp,
          clientID,
        );

        await dagWrite.putChunk(c.chunk);
        await dagWrite.setHead('test', c.chunk.hash);
        await dagWrite.commit();

        return c;
      });
    }

    const clientID1 = 'client-id-1';
    const clientID2 = 'client-id-2';
    const clientGroupID = 'client-group-1';

    const s1 = await makeSnapshot({
      store: perdag,
      lastMutationIDs: {[clientID1]: 3, [clientID2]: 2},
      cookieJSON: 1,
    });
    const l1 = await makeLocalMutation({
      store: perdag,
      clientID: clientID2,
      mutationID: 3,
      basisHash: s1.chunk.hash,
      mutatorName: 'addData',
      mutatorArgsJSON: {a: 1},
      valueHash: s1.chunk.data.valueHash,
      // entries: [['a', 1]],
    });
    const l2 = await makeLocalMutation({
      store: perdag,
      clientID: clientID1,
      mutationID: 4,
      basisHash: l1.chunk.hash,
      mutatorName: 'addData',
      mutatorArgsJSON: {b: 2},
      valueHash: l1.chunk.data.valueHash,
      // entries: [['b', 2]],
    });

    await withWrite(perdag, async dagWrite => {
      await setClient(
        clientID1,
        {
          clientGroupID,
          headHash: l2.chunk.hash,
          heartbeatTimestampMs: 1,
          tempRefreshHash: null,
        },
        dagWrite,
      );
      await setClient(
        clientID2,
        {
          clientGroupID,
          headHash: l2.chunk.hash,
          heartbeatTimestampMs: 2,
          tempRefreshHash: null,
        },
        dagWrite,
      );
      await setClientGroup(
        clientGroupID,
        {
          headHash: l2.chunk.hash,
          indexes: {},
          mutationIDs: {[clientID1]: 4, [clientID2]: 3},
          lastServerAckdMutationIDs: {[clientID1]: 0, [clientID2]: 0},
          mutatorNames: ['addData'],
          disabled: false,
        },
        dagWrite,
      );

      await dagWrite.removeHead('test');
      await dagWrite.commit();
    });

    // Memdag
    {
      const s1 = await makeSnapshot({
        store: memdag,
        lastMutationIDs: {[clientID1]: 3, [clientID2]: 2},
        cookieJSON: 1,
      });
      const l1 = await makeLocalMutation({
        store: memdag,
        clientID: clientID1,
        mutationID: 4,
        basisHash: s1.chunk.hash,
        mutatorName: 'addData',
        mutatorArgsJSON: {b: 2},
        valueHash: s1.chunk.data.valueHash,
      });
      const l2 = await makeLocalMutation({
        store: memdag,
        clientID: clientID1,
        mutationID: 5,
        basisHash: l1.chunk.hash,
        mutatorName: 'addData',
        mutatorArgsJSON: {c: 3},
        valueHash: l1.chunk.data.valueHash,
      });

      await withWrite(memdag, async dagWrite => {
        await dagWrite.setHead(db.DEFAULT_HEAD_NAME, l2.chunk.hash);
        await dagWrite.removeHead('test');
        await dagWrite.commit();
      });
    }

    const result = await refresh(
      new LogContext(),
      memdag,
      perdag,
      clientID1,
      {
        addData,
      },
      testSubscriptionsManagerOptions,
      () => false,
    );
    assert(result);
    expect(result[0]).to.deep.equal(
      await withRead(memdag, read => read.getHead(db.DEFAULT_HEAD_NAME)),
    );
    expect(Object.fromEntries(result[1])).to.deep.equal({
      '': [{key: 'c', newValue: 3, op: 'add'}],
    });
  });
});
