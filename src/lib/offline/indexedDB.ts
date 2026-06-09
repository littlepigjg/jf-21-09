import type { Project, ProjectMeta, SyncOperation, PersistedState } from '@/types';

const DB_NAME = 'gif-studio-db';
const DB_VERSION = 1;

const STORES = {
  PROJECTS: 'projects',
  PROJECT_META: 'projectMeta',
  SYNC_QUEUE: 'syncQueue',
  APP_STATE: 'appState',
} as const;

type StoreName = (typeof STORES)[keyof typeof STORES];

let dbInstance: IDBDatabase | null = null;
let initPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbInstance) return Promise.resolve(dbInstance);
  if (initPromise) return initPromise;

  initPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      dbInstance = request.result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        initPromise = null;
      };
      resolve(dbInstance);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORES.PROJECTS)) {
        const projectStore = db.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
        projectStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        projectStore.createIndex('isDirty', 'isDirty', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.PROJECT_META)) {
        const metaStore = db.createObjectStore(STORES.PROJECT_META, { keyPath: 'id' });
        metaStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.SYNC_QUEUE)) {
        const syncStore = db.createObjectStore(STORES.SYNC_QUEUE, { keyPath: 'id' });
        syncStore.createIndex('projectId', 'projectId', { unique: false });
        syncStore.createIndex('status', 'status', { unique: false });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORES.APP_STATE)) {
        db.createObjectStore(STORES.APP_STATE, { keyPath: 'key' });
      }
    };
  });

  return initPromise;
}

function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction<T>(
  storeName: StoreName,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T> | Promise<T> | T
): Promise<T> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);

    let result: T | undefined;
    let callbackError: unknown | null = null;
    let callbackSettled = false;
    let transactionCompleted = false;

    const tryResolve = () => {
      if (callbackSettled && transactionCompleted) {
        if (callbackError) {
          reject(callbackError);
        } else {
          resolve(result as T);
        }
      }
    };

    transaction.oncomplete = () => {
      transactionCompleted = true;
      tryResolve();
    };
    transaction.onerror = () => {
      callbackError = transaction.error;
      transactionCompleted = true;
      tryResolve();
    };
    transaction.onabort = () => {
      callbackError = transaction.error;
      transactionCompleted = true;
      tryResolve();
    };

    Promise.resolve()
      .then(() => callback(store))
      .then(async (r) => {
        if (r instanceof IDBRequest) {
          result = await promisifyRequest(r);
        } else {
          result = r;
        }
      })
      .catch((err) => {
        callbackError = err;
        try {
          transaction.abort();
        } catch {
          // noop
        }
      })
      .finally(() => {
        callbackSettled = true;
        tryResolve();
      });
  });
}

export const projectsDB = {
  async save(project: Project): Promise<void> {
    await runTransaction(STORES.PROJECTS, 'readwrite', (store) => store.put(project));
  },

  async get(id: string): Promise<Project | undefined> {
    return runTransaction(STORES.PROJECTS, 'readonly', (store) => store.get(id));
  },

  async delete(id: string): Promise<void> {
    await runTransaction(STORES.PROJECTS, 'readwrite', (store) => store.delete(id));
  },

  async getAll(): Promise<Project[]> {
    return runTransaction(STORES.PROJECTS, 'readonly', (store) => {
      const request = store.getAll();
      return new Promise<Project[]>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result.sort((a, b) => b.updatedAt - a.updatedAt));
        request.onerror = () => reject(request.error);
      });
    });
  },

  async getDirty(): Promise<Project[]> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.PROJECTS, 'readonly');
      const store = transaction.objectStore(STORES.PROJECTS);
      const index = store.index('isDirty');
      const request = index.getAll(IDBKeyRange.only(true));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
};

export const projectMetaDB = {
  async save(meta: ProjectMeta): Promise<void> {
    await runTransaction(STORES.PROJECT_META, 'readwrite', (store) => store.put(meta));
  },

  async get(id: string): Promise<ProjectMeta | undefined> {
    return runTransaction(STORES.PROJECT_META, 'readonly', (store) => store.get(id));
  },

  async delete(id: string): Promise<void> {
    await runTransaction(STORES.PROJECT_META, 'readwrite', (store) => store.delete(id));
  },

  async list(): Promise<ProjectMeta[]> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.PROJECT_META, 'readonly');
      const store = transaction.objectStore(STORES.PROJECT_META);
      const index = store.index('updatedAt');
      const request = index.openCursor(null, 'prev');
      const results: ProjectMeta[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  },
};

export const syncQueueDB = {
  async enqueue(operation: Omit<SyncOperation, 'retries' | 'status'>): Promise<void> {
    const op: SyncOperation = {
      ...operation,
      retries: 0,
      status: 'pending',
    };
    await runTransaction(STORES.SYNC_QUEUE, 'readwrite', (store) => store.put(op));
  },

  async getPending(): Promise<SyncOperation[]> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SYNC_QUEUE, 'readonly');
      const store = transaction.objectStore(STORES.SYNC_QUEUE);
      const index = store.index('status');
      const request = index.getAll(IDBKeyRange.only('pending'));
      request.onsuccess = () => resolve(request.result.sort((a, b) => a.timestamp - b.timestamp));
      request.onerror = () => reject(request.error);
    });
  },

  async updateStatus(id: string, status: SyncOperation['status'], error?: string): Promise<void> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
      const store = transaction.objectStore(STORES.SYNC_QUEUE);
      const getRequest = store.get(id);
      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (record) {
          record.status = status;
          if (error) record.error = error;
          if (status === 'failed') record.retries = (record.retries || 0) + 1;
          store.put(record);
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  async remove(id: string): Promise<void> {
    await runTransaction(STORES.SYNC_QUEUE, 'readwrite', (store) => store.delete(id));
  },

  async getByProject(projectId: string): Promise<SyncOperation[]> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SYNC_QUEUE, 'readonly');
      const store = transaction.objectStore(STORES.SYNC_QUEUE);
      const index = store.index('projectId');
      const request = index.getAll(IDBKeyRange.only(projectId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  async clearCompleted(): Promise<void> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SYNC_QUEUE, 'readwrite');
      const store = transaction.objectStore(STORES.SYNC_QUEUE);
      const index = store.index('status');
      const request = index.openCursor(IDBKeyRange.only('completed'));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  async countPending(): Promise<number> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORES.SYNC_QUEUE, 'readonly');
      const store = transaction.objectStore(STORES.SYNC_QUEUE);
      const index = store.index('status');
      const request = index.count(IDBKeyRange.only('pending'));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
};

export const appStateDB = {
  async getPersistedState(): Promise<PersistedState | null> {
    const result = await runTransaction<{ key: string; value: PersistedState } | undefined>(
      STORES.APP_STATE,
      'readonly',
      (store) => store.get('persistedState')
    );
    return result ? result.value : null;
  },

  async savePersistedState(state: PersistedState): Promise<void> {
    await runTransaction(STORES.APP_STATE, 'readwrite', (store) =>
      store.put({ key: 'persistedState', value: state })
    );
  },
};

export function isIndexedDBSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export function closeDatabase(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
    initPromise = null;
  }
}
