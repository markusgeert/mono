import type {LogContext} from '@rocicorp/logger';
import {assert, unreachable} from '../asserts.js';
import type * as dag from '../dag/mod';
import {
  compareCookiesForSnapshots,
  fromHash,
  fromHead,
  LocalMetaDD31,
  localMutationsGreaterThan,
} from '../db/commit.js';
import * as db from '../db/mod';
import {
  assertClientDD31,
  getClient,
  getMainBranch,
  setClient,
} from '../persist/clients.js';
import type {MutatorDefs} from '../replicache.js';
import type {ClientID} from './client-id.js';
import {diffCommits, DiffsMap} from './diff.js';
import {rebaseMutation} from './rebase.js';

const ABORTED = 1;
const COMPLETED = 2;
const INPROGRESS = 3;

type Result =
  | {
      state: typeof ABORTED;
    }
  | {
      state: typeof COMPLETED;
      diffs: DiffsMap;
    }
  | {
      state: typeof INPROGRESS;
      mutations: db.Commit<LocalMetaDD31>[];
    };

const REFRESH_HEAD_NAME = 'refresh';

/**
 * This returns the diff between the state of the btree before and after
 * refresh. It returns `undefined` if the refresh was aborted.
 */
export async function refresh(
  lc: LogContext,
  memdag: dag.Store,
  perdag: dag.Store,
  clientID: ClientID,
  mutators: MutatorDefs,
): Promise<DiffsMap | undefined> {
  assert(DD31);

  const perdagMainHead = await perdag.withWrite(async perdagWrite => {
    const mainBranch = await getMainBranch(clientID, perdagWrite);
    assert(mainBranch, `No main branch for clientID: ${clientID}`);
    const perdagMainHead = mainBranch.headHash;
    // Need to pull this head into memdag, but can't have it disappear if
    // perdag moves forward while we're rebasing in memdag. Can't change client
    // headHash until our rebase in memdag is complete, because if rebase fails,
    // then nothing is keeping client's main alive in perdag.
    const client = await getClient(clientID, perdagWrite);
    assertClientDD31(client);
    const newClient = {
      ...client,
      tempRefreshHash: perdagMainHead,
    };
    await setClient(clientID, newClient, perdagWrite);
    await perdagWrite.commit();
    return perdagMainHead;
  });

  let refreshHead = perdagMainHead;
  let result: Result | undefined;
  while (result === undefined || result.state === INPROGRESS) {
    result = await memdag.withWrite(async (memdagWrite): Promise<Result> => {
      // On the initial iteration this sets refresh head to perdagMainHead
      await memdagWrite.setHead(REFRESH_HEAD_NAME, refreshHead);
      const currMemdagCommit = await fromHead(
        db.DEFAULT_HEAD_NAME,
        memdagWrite,
      );
      const refreshHeadCommit = await fromHash(refreshHead, memdagWrite);

      const memdagMainBaseSnapshot = await db.baseSnapshotFromCommit(
        currMemdagCommit,
        memdagWrite,
      );
      const refreshBaseSnapshot = await db.baseSnapshotFromCommit(
        refreshHeadCommit,
        memdagWrite,
      );

      // If main's snapshot is newer than refresh's snapshot abort refresh
      if (
        compareCookiesForSnapshots(
          memdagMainBaseSnapshot,
          refreshBaseSnapshot,
        ) > 0
      ) {
        await memdagWrite.removeHead(REFRESH_HEAD_NAME);
        return {state: ABORTED};
      }
      const refreshLMID = await refreshHeadCommit.getMutationID(
        clientID,
        memdagWrite,
      );
      const newMutations = await localMutationsGreaterThan(
        currMemdagCommit,
        {[clientID]: refreshLMID},
        memdagWrite,
      );
      if (newMutations.length === 0) {
        // rebased everything without main changing, refresh done
        // compute diffs and update main
        const diffs = await diffCommits(
          currMemdagCommit,
          refreshHeadCommit,
          memdagWrite,
        );
        await memdagWrite.setHead(db.DEFAULT_HEAD_NAME, refreshHead);
        await memdagWrite.removeHead(REFRESH_HEAD_NAME);
        await memdagWrite.commit();
        return {
          state: COMPLETED,
          diffs,
        };
      }

      await memdagWrite.commit();
      return {
        state: INPROGRESS,
        mutations: newMutations,
      };
    });

    if (result.state === INPROGRESS) {
      for (let i = result.mutations.length - 1; i >= 0; i--) {
        const commit = result.mutations[i];
        await memdag.withWrite(async memdagWrite => {
          assert(refreshHead);
          refreshHead = await rebaseMutation(
            commit,
            memdagWrite,
            refreshHead,
            mutators,
            lc,
            clientID,
          );
          await memdagWrite.setHead(REFRESH_HEAD_NAME, refreshHead);
          await memdagWrite.commit();
        });
      }
    }
  }

  await perdag.withWrite(async perdagWrite => {
    const client = await getClient(clientID, perdagWrite);
    assert(client);
    assert(result);
    const newClient = {
      ...client,
      headHash: result.state === ABORTED ? client.headHash : perdagMainHead,
      tempRefreshHash: undefined,
    };

    // If this cleanup never happens, it's no big deal, some data will stay
    // alive longer but next refresh will fix it.
    await setClient(clientID, newClient, perdagWrite);
  });

  switch (result.state) {
    case ABORTED:
      return undefined;
    case COMPLETED:
      return result.diffs;
    default:
      unreachable();
  }
}
