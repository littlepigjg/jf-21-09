import { syncQueueDB, projectsDB, projectMetaDB } from './indexedDB';
import { isOnline, subscribeNetworkStatus, waitForOnline, pingCheck } from './network';
import { requestBackgroundSync, subscribeSWMessages } from './serviceWorker';
import type { SyncOperation, SyncStatus, Project, ProjectMeta } from '@/types';

type SyncStatusListener = (status: SyncStatus, pendingCount: number, error?: string) => void;

const MAX_RETRIES = 5;
const RETRY_DELAY_BASE = 1000;
const SYNC_BATCH_SIZE = 10;
const SYNC_TAG = 'sync-project-data';

let currentStatus: SyncStatus = 'idle';
let pendingCount = 0;
const listeners = new Set<SyncStatusListener>();
let isInitialized = false;
let syncTimeout: ReturnType<typeof setTimeout> | null = null;

function notifyListeners(error?: string) {
  for (const listener of listeners) {
    try {
      listener(currentStatus, pendingCount, error);
    } catch (err) {
      console.error('[Sync] Listener error:', err);
    }
  }
}

async function updatePendingCount() {
  try {
    pendingCount = await syncQueueDB.countPending();
  } catch {
    pendingCount = 0;
  }
}

function setStatus(status: SyncStatus, error?: string) {
  currentStatus = status;
  notifyListeners(error);
}

function computeRetryDelay(retries: number): number {
  return RETRY_DELAY_BASE * Math.pow(2, Math.min(retries, 5));
}

async function executeOperation(op: SyncOperation): Promise<void> {
  switch (op.type) {
    case 'project.create':
    case 'project.update': {
      const project = op.payload as Project;
      await projectsDB.save(project);
      const meta: ProjectMeta = {
        id: project.id,
        name: project.name,
        frameCount: project.frames.length,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        syncedAt: Date.now(),
        isDirty: false,
      };
      await projectMetaDB.save(meta);
      break;
    }
    case 'project.delete': {
      const projectId = op.payload as string;
      await projectsDB.delete(projectId);
      await projectMetaDB.delete(projectId);
      break;
    }
    case 'frame.add':
    case 'frame.delete':
    case 'frame.update':
    case 'frame.reorder':
    case 'caption.add':
    case 'caption.update':
    case 'caption.delete': {
      const project = op.payload as Project;
      await projectsDB.save(project);
      const existingMeta = await projectMetaDB.get(project.id);
      const meta: ProjectMeta = {
        id: project.id,
        name: project.name,
        frameCount: project.frames.length,
        thumbnail: existingMeta?.thumbnail,
        createdAt: existingMeta?.createdAt ?? project.createdAt,
        updatedAt: project.updatedAt,
        syncedAt: Date.now(),
        isDirty: false,
      };
      await projectMetaDB.save(meta);
      break;
    }
    default:
      console.warn('[Sync] Unknown operation type:', op.type);
  }
}

async function processBatch(): Promise<{ success: number; failed: number }> {
  const pending = await syncQueueDB.getPending();
  const batch = pending.slice(0, SYNC_BATCH_SIZE);

  if (batch.length === 0) {
    return { success: 0, failed: 0 };
  }

  let success = 0;
  let failed = 0;

  for (const op of batch) {
    try {
      await syncQueueDB.updateStatus(op.id, 'processing');
      await executeOperation(op);
      await syncQueueDB.updateStatus(op.id, 'completed');
      await syncQueueDB.remove(op.id);
      success++;
    } catch (err) {
      failed++;
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      if (op.retries >= MAX_RETRIES) {
        await syncQueueDB.updateStatus(op.id, 'failed', errorMessage);
      } else {
        await syncQueueDB.updateStatus(op.id, 'pending', errorMessage);
      }
    }
  }

  await syncQueueDB.clearCompleted();
  return { success, failed };
}

async function runSyncCycle(): Promise<void> {
  if (currentStatus === 'syncing') return;

  if (!isOnline()) {
    try {
      await waitForOnline(30000);
    } catch {
      setStatus('error', 'Network unavailable');
      return;
    }
  }

  const networkOk = await pingCheck();
  if (!networkOk) {
    setStatus('error', 'Network connectivity check failed');
    return;
  }

  setStatus('syncing');

  try {
    let totalSuccess = 0;
    let totalFailed = 0;
    let hasMore = true;

    while (hasMore) {
      const result = await processBatch();
      totalSuccess += result.success;
      totalFailed += result.failed;

      await updatePendingCount();
      hasMore = pendingCount > 0 && isOnline();
    }

    if (totalFailed > 0) {
      setStatus('error', `${totalFailed} operations failed`);
    } else {
      setStatus('success');
      setTimeout(() => {
        if (currentStatus === 'success') {
          setStatus('idle');
        }
      }, 2000);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : 'Sync failed';
    setStatus('error', errorMessage);
  }
}

function scheduleRetry(delayMs: number) {
  if (syncTimeout) {
    clearTimeout(syncTimeout);
  }
  syncTimeout = setTimeout(() => {
    syncTimeout = null;
    void triggerSync();
  }, delayMs);
}

export async function triggerSync(): Promise<void> {
  await updatePendingCount();

  if (pendingCount === 0) {
    setStatus('idle');
    return;
  }

  if (!isOnline()) {
    setStatus('idle');
    await requestBackgroundSync(SYNC_TAG);
    return;
  }

  await runSyncCycle();

  if (currentStatus === 'error' && pendingCount > 0) {
    const pending = await syncQueueDB.getPending();
    if (pending.length > 0) {
      const maxRetries = Math.max(...pending.map((o) => o.retries));
      scheduleRetry(computeRetryDelay(maxRetries));
    }
  }
}

export function subscribeSyncStatus(listener: SyncStatusListener): () => void {
  listeners.add(listener);
  listener(currentStatus, pendingCount);
  return () => listeners.delete(listener);
}

export function getSyncStatus(): { status: SyncStatus; pendingCount: number } {
  return { status: currentStatus, pendingCount };
}

export async function enqueueOperation(
  type: SyncOperation['type'],
  projectId: string,
  payload: unknown
): Promise<void> {
  await syncQueueDB.enqueue({
    id: `op_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    projectId,
    payload,
    timestamp: Date.now(),
  });
  await updatePendingCount();

  if (isOnline() && currentStatus !== 'syncing') {
    scheduleRetry(500);
  } else {
    await requestBackgroundSync(SYNC_TAG);
  }
}

export async function initSyncManager(): Promise<void> {
  if (isInitialized) return;
  isInitialized = true;

  await updatePendingCount();

  subscribeNetworkStatus((status) => {
    if (status.isOnline && status.wasOffline && pendingCount > 0) {
      setTimeout(() => void triggerSync(), 1000);
    }
  });

  subscribeSWMessages((message) => {
    if (message.type === 'TRIGGER_SYNC') {
      void triggerSync();
    }
  });

  if (pendingCount > 0 && isOnline()) {
    setTimeout(() => void triggerSync(), 2000);
  }
}
