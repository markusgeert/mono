import {tmpdir} from 'node:os';
import path from 'node:path';
import {parentPort, threadId, workerData} from 'node:worker_threads';
import postgres from 'postgres';
import {assert} from 'shared/src/asserts.js';
import {randInt} from 'shared/src/rand.js';
import {MutagenService} from '../services/mutagen/mutagen.js';
import {ReplicaVersionReady} from '../services/replicator/replicator.js';
import {DatabaseStorage} from '../services/view-syncer/database-storage.js';
import {PipelineDriver} from '../services/view-syncer/pipeline-driver.js';
import {Snapshotter} from '../services/view-syncer/snapshotter.js';
import {ViewSyncerService} from '../services/view-syncer/view-syncer.js';
import {postgresTypeConfig} from '../types/pg.js';
import {Subscription} from '../types/subscription.js';
import {Syncer} from '../workers/syncer.js';
import {configFromEnv} from './config.js';
import {ReadySignal} from './life-cycle.js';
import {createLogContext} from './logging.js';

const config = configFromEnv();
assert(parentPort);

// Consider parameterizing these (in main) based on total number of workers.
const MAX_CVR_CONNECTIONS = 5;
const MAX_MUTAGEN_CONNECTIONS = 5;

const lc = createLogContext(config, {thread: 'syncer'});

const cvrDB = postgres(config.CVR_DB_URI, {
  ...postgresTypeConfig(),
  max: MAX_CVR_CONNECTIONS,
});

const upstreamDB = postgres(config.UPSTREAM_URI, {
  ...postgresTypeConfig(),
  max: MAX_MUTAGEN_CONNECTIONS,
});

const dbWarmup = Promise.allSettled([
  ...Array.from({length: MAX_CVR_CONNECTIONS}, () =>
    cvrDB`SELECT 1`.simple().execute(),
  ),
  ...Array.from({length: MAX_MUTAGEN_CONNECTIONS}, () =>
    upstreamDB`SELECT 1`.simple().execute(),
  ),
]);

const tmpDir = config.STORAGE_DB_TMP_DIR ?? tmpdir();
const operatorStorage = DatabaseStorage.create(
  lc,
  path.join(tmpDir, `sync-worker-${threadId}-${randInt(1000000, 9999999)}`),
);

const viewSyncerFactory = (
  id: string,
  sub: Subscription<ReplicaVersionReady>,
) =>
  new ViewSyncerService(
    lc,
    id,
    cvrDB,
    new PipelineDriver(
      lc,
      new Snapshotter(lc, config.REPLICA_DB_FILE),
      operatorStorage.createClientGroupStorage(id),
    ),
    sub,
  );

const mutagenFactory = (id: string) => new MutagenService(lc, id, upstreamDB);

new Syncer(lc, viewSyncerFactory, mutagenFactory, parentPort, workerData).run();

void dbWarmup.then(
  () => parentPort?.postMessage({ready: true} satisfies ReadySignal),
);
