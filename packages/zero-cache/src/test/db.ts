import postgres from 'postgres';
import {assert} from 'shared/src/asserts.js';
import {sleep} from 'shared/src/sleep.js';
import {afterAll, expect} from 'vitest';
import {PostgresDB, postgresTypeConfig} from '../types/pg.js';

class TestDBs {
  // Connects to the main "postgres" DB of the local Postgres cluster.
  //
  // Note: In order to run all of the tests successfully, the following
  // configuration needs to be set in postgresql.conf:
  //
  // wal_level = logical                    # default is replica
  // max_logical_replication_workers = 20   # default is 4
  readonly #sql = postgres({
    database: 'postgres',
    onnotice: () => {},
    ...postgresTypeConfig(),
  });
  readonly #dbs: Record<string, postgres.Sql> = {};

  async create(database: string): Promise<PostgresDB> {
    assert(!(database in this.#dbs), `${database} has already been created`);

    await this.#sql`
    DROP DATABASE IF EXISTS ${this.#sql(database)} WITH (FORCE)`;

    await this.#sql`
    CREATE DATABASE ${this.#sql(database)}`;

    const db = postgres({
      database,
      onnotice: () => {},
      ...postgresTypeConfig(),
    });
    this.#dbs[database] = db;
    return db;
  }

  async drop(...dbs: postgres.Sql[]) {
    await Promise.all(dbs.map(db => this.#drop(db)));
  }

  async #drop(db: postgres.Sql) {
    const {database} = db.options;
    await db.end();
    await this.#sql`
    DROP DATABASE IF EXISTS ${this.#sql(database)} WITH (FORCE)`;

    delete this.#dbs[database];
  }

  /**
   * This automatically is called on the exported `testDBs` instance
   * in the `afterAll()` hook in this file, so there is no need to call
   * it manually.
   */
  async end() {
    await this.drop(...[...Object.values(this.#dbs)]);
    return this.#sql.end();
  }
}

export const testDBs = new TestDBs();

afterAll(async () => {
  await testDBs.end();
});

export async function initDB(
  db: postgres.Sql,
  statements?: string,
  tables?: Record<string, object[]>,
) {
  await db.begin(async tx => {
    if (statements) {
      await db.unsafe(statements);
    }
    await Promise.all(
      Object.entries(tables ?? {}).map(
        ([table, existing]) => tx`INSERT INTO ${tx(table)} ${tx(existing)}`,
      ),
    );
  });
}

export async function expectTables(
  db: postgres.Sql,
  tables?: Record<string, unknown[]>,
) {
  for (const [table, expected] of Object.entries(tables ?? {})) {
    const actual = await db`SELECT * FROM ${db(table)}`;
    expect(actual).toEqual(expect.arrayContaining(expected));
    expect(expected).toEqual(expect.arrayContaining(actual));
  }
}

export async function dropReplicationSlot(db: postgres.Sql, slotName: string) {
  // A replication slot can't be dropped when it is still marked "active" on the upstream
  // database. The slot becomes inactive when the downstream connection is closed (e.g. the
  // initial-sync SUBSCRIPTION is disabled, or the incremental-sync connection is closed),
  // but because this is a non-transactional process that happens in the internals of Postgres,
  // we have to poll the status and wait for the slot to be released.
  for (let i = 0; i < 100; i++) {
    const results = await db<{slotName: string; active: boolean}[]>`
    SELECT slot_name as "slotName", active FROM pg_replication_slots WHERE slot_name = ${slotName}`;

    if (results.count === 0) {
      break;
    }
    const result = results[0];
    if (!result.active) {
      await db`SELECT pg_drop_replication_slot(${slotName})`;
      break;
    }
    await sleep(10);
  }
}
