import {deleteDB, IDBPDatabase, openDB} from 'idb/with-async-ittr';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Invalid module when using node16 module resolution.
import xbytes from 'xbytes';
import {randomData, RandomDataType} from '../data.js';
import type {Bencher, Benchmark} from '../perf.js';

export function benchmarkIDBReadGetAll(opts: {
  dataType: RandomDataType;
  group: string;
  valSize: number;
  numKeys: number;
}): Benchmark {
  const dbName = 'db1';
  const storeName = 'store1';
  return {
    name: `idb read tx getAll (${opts.dataType}) ${opts.numKeys}x${xbytes(
      opts.valSize,
      {
        fixed: 0,
        iec: true,
      },
    )}`,
    group: opts.group,
    byteSize: opts.valSize * opts.numKeys,
    async setup() {
      await deleteDB(dbName);
      const db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(storeName);
        },
      });
      try {
        await idbPopulate(
          db,
          randomData(opts.dataType, opts.numKeys, opts.valSize),
        );
      } finally {
        db.close();
      }
    },

    async run(bench: Bencher) {
      const db = await openDB(dbName);
      try {
        bench.reset();
        const tx = db.transaction(storeName, 'readonly', {
          durability: 'relaxed',
        });
        const store = tx.objectStore(storeName);
        const values = await store.getAll(
          IDBKeyRange.bound(0, opts.numKeys - 1),
        );

        bench.stop();
        // Use the values to ensure they aren't optimized away.
        console.log(`Read ${values.length} values`);
      } finally {
        db.close();
      }
    },
  };
}

export function benchmarkIDBReadGetAllGetAllKeys(opts: {
  dataType: RandomDataType;
  group: string;
  valSize: number;
  numKeys: number;
}): Benchmark {
  const dbName = 'db1';
  const storeName = 'store1';
  return {
    name: `idb read tx getAll & getAllKeys (${opts.dataType}) ${
      opts.numKeys
    }x${xbytes(opts.valSize, {
      fixed: 0,
      iec: true,
    })}`,
    group: opts.group,
    byteSize: opts.valSize * opts.numKeys,
    async setup() {
      await deleteDB(dbName);
      const db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore('store1');
        },
      });
      try {
        await idbPopulate(
          db,
          randomData(opts.dataType, opts.numKeys, opts.valSize),
        );
      } finally {
        db.close();
      }
    },

    async run(bench: Bencher) {
      const db = await openDB(dbName);
      try {
        bench.reset();
        const tx = db.transaction(storeName, 'readonly', {
          durability: 'relaxed',
        });
        const store = tx.objectStore(storeName);
        const query = IDBKeyRange.bound(0, opts.numKeys - 1);
        const [values, keys] = await Promise.all([
          store.getAll(query),
          store.getAllKeys(query),
        ]);

        bench.stop();
        // Use the values to ensure they aren't optimized away.
        console.log(`Read ${values.length} values and ${keys.length} keys`);
      } finally {
        db.close();
      }
    },
  };
}

export function benchmarkIDBReadGet(opts: {
  dataType: RandomDataType;
  group: string;
  valSize: number;
  numKeys: number;
}): Benchmark {
  const dbName = 'db1';
  const storeName = 'store1';
  return {
    name: `idb read tx get (${opts.dataType}) ${opts.numKeys}x${xbytes(
      opts.valSize,
      {
        fixed: 0,
        iec: true,
      },
    )}`,
    group: opts.group,
    byteSize: opts.valSize * opts.numKeys,
    async setup() {
      await deleteDB(dbName);
      const db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(storeName);
        },
      });
      try {
        await idbPopulate(
          db,
          randomData(opts.dataType, opts.numKeys, opts.valSize),
        );
      } finally {
        db.close();
      }
    },

    async run(bench: Bencher) {
      const db = await openDB(dbName);
      try {
        bench.reset();
        const tx = db.transaction(storeName, 'readonly', {
          durability: 'relaxed',
        });
        const store = tx.objectStore(storeName);
        const values = await Promise.all(
          Array.from({length: opts.numKeys}, (_, i) => store.get(i)),
        );

        bench.stop();
        // Use the values to ensure they aren't optimized away.
        console.log(`Read ${values.length} values`);
      } finally {
        db.close();
      }
    },
  };
}

async function idbPopulate(
  db: IDBPDatabase<unknown>,
  data: (string | Record<string, string> | ArrayBuffer | Blob)[],
) {
  const tx = db.transaction('store1', 'readwrite', {durability: 'relaxed'});
  const store = tx.objectStore('store1');
  await Promise.all(data.map((v, i) => store.put(v, i)));
  await tx.done;
}

async function idbPopulateInlineKey(
  db: IDBPDatabase<unknown>,
  storeName: string,
  data: (string | Record<string, string> | ArrayBuffer | Blob)[],
) {
  const tx = db.transaction(storeName, 'readwrite', {durability: 'relaxed'});
  const store = tx.objectStore(storeName);
  await Promise.all(data.map((v, i) => store.put({key: i, value: v})));
  await tx.done;
}

export function benchmarkIDBWrite(opts: {
  dataType: RandomDataType;
  group: string;
  valSize: number;
  numKeys: number;
}): {
  name: string;
  group: string;
  byteSize: number;
  setup(): Promise<void>;
  run(bench: Bencher): Promise<void>;
} {
  return {
    name: `idb write tx (${opts.dataType}) ${opts.numKeys}x${xbytes(
      opts.valSize,
      {
        fixed: 0,
        iec: true,
      },
    )}`,
    group: opts.group,
    byteSize: opts.valSize * opts.numKeys,

    async setup() {
      await deleteDB('db1');
      const db = await openDB('db1', 1, {
        upgrade(db) {
          db.createObjectStore('store1');
        },
      });
      db.close();
    },

    async run(bench: Bencher) {
      const db = await openDB('db1');
      try {
        const data = randomData(opts.dataType, opts.numKeys, opts.valSize);
        bench.reset();
        await idbPopulate(db, data);
        bench.stop();
      } finally {
        db.close();
      }
    },
  };
}

export function benchmarkIDBReadGetWithInlineKeys(opts: {
  dataType: RandomDataType;
  group: string;
  valSize: number;
  numKeys: number;
}): Benchmark {
  const dbName = 'db2';
  const storeName = 'store2';
  return {
    name: `idb read inline tx get (${opts.dataType}) ${opts.numKeys}x${xbytes(
      opts.valSize,
      {
        fixed: 0,
        iec: true,
      },
    )}`,
    group: opts.group,
    byteSize: opts.valSize * opts.numKeys,
    async setup() {
      await deleteDB(dbName);
      const db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(storeName, {keyPath: 'key'});
        },
      });
      try {
        await idbPopulateInlineKey(
          db,
          storeName,
          randomData(opts.dataType, opts.numKeys, opts.valSize),
        );
      } finally {
        db.close();
      }
    },

    async run(bench: Bencher) {
      const db = await openDB(dbName);
      try {
        bench.reset();
        const tx = db.transaction(storeName, 'readonly', {
          durability: 'relaxed',
        });
        const store = tx.objectStore(storeName);
        const vals = await Promise.all(
          Array.from({length: opts.numKeys}, (_, i) => store.get(i)),
        );

        bench.stop();
        // Use the values to ensure they aren't optimized away.
        console.log(`Read ${vals.length} values`);
      } finally {
        db.close();
      }
    },
  };
}

export function benchmarkIDBReadGetAllWithInlineKey(opts: {
  dataType: RandomDataType;
  group: string;
  valSize: number;
  numKeys: number;
}): Benchmark {
  const dbName = 'db2';
  const storeName = 'store2';
  return {
    name: `idb read inline tx getAll (${opts.dataType}) ${
      opts.numKeys
    }x${xbytes(opts.valSize, {
      fixed: 0,
      iec: true,
    })}`,
    group: opts.group,
    byteSize: opts.valSize * opts.numKeys,
    async setup() {
      await deleteDB(dbName);
      const db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(storeName, {keyPath: 'key'});
        },
      });
      try {
        await idbPopulateInlineKey(
          db,
          storeName,
          randomData(opts.dataType, opts.numKeys, opts.valSize),
        );
      } finally {
        db.close();
      }
    },

    async run(bench: Bencher) {
      const db = await openDB(dbName);
      try {
        bench.reset();
        const tx = db.transaction(storeName, 'readonly', {
          durability: 'relaxed',
        });
        const store = tx.objectStore(storeName);
        const values = await store.getAll(
          IDBKeyRange.bound(0, opts.numKeys - 1),
        );

        bench.stop();
        // Use the values to ensure they aren't optimized away.
        console.log(`Read ${values.length} values`);
      } finally {
        db.close();
      }
    },
  };
}

export function benchmarkIDBWriteWithInlineKey(opts: {
  dataType: RandomDataType;
  group: string;
  valSize: number;
  numKeys: number;
}): {
  name: string;
  group: string;
  byteSize: number;
  setup(): Promise<void>;
  run(bench: Bencher): Promise<void>;
} {
  const dbName = 'db2';
  const storeName = 'store2';
  return {
    name: `idb write inline tx (${opts.dataType}) ${opts.numKeys}x${xbytes(
      opts.valSize,
      {
        fixed: 0,
        iec: true,
      },
    )}`,
    group: opts.group,
    byteSize: opts.valSize * opts.numKeys,

    async setup() {
      await deleteDB(dbName);
      const db = await openDB(dbName, 1, {
        upgrade(db) {
          db.createObjectStore(storeName, {keyPath: 'key'});
        },
      });
      db.close();
    },

    async run(bench: Bencher) {
      const db = await openDB(dbName);
      try {
        const data = randomData(opts.dataType, opts.numKeys, opts.valSize);
        bench.reset();
        await idbPopulateInlineKey(db, storeName, data);
        bench.stop();
      } finally {
        db.close();
      }
    },
  };
}