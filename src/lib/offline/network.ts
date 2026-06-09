import type { NetworkStatus } from '@/types';

type NetworkChangeListener = (status: NetworkStatus) => void;

let currentStatus: NetworkStatus | null = null;
const listeners = new Set<NetworkChangeListener>();

function getConnectionInfo(): Partial<NetworkStatus> {
  const nav = navigator as Navigator & {
    connection?: {
      downlink?: number;
      effectiveType?: string;
      addEventListener?: (type: string, handler: () => void) => void;
      removeEventListener?: (type: string, handler: () => void) => void;
    };
  };

  if (nav.connection) {
    return {
      downlink: nav.connection.downlink,
      effectiveType: nav.connection.effectiveType,
    };
  }
  return {};
}

function computeStatus(): NetworkStatus {
  const now = Date.now();
  const wasOffline = currentStatus?.isOnline === false;

  return {
    isOnline: navigator.onLine,
    wasOffline,
    since: currentStatus?.since ?? now,
    ...getConnectionInfo(),
  };
}

function notifyListeners() {
  if (!currentStatus) return;
  for (const listener of listeners) {
    try {
      listener(currentStatus);
    } catch (err) {
      console.error('[Network] Listener error:', err);
    }
  }
}

function updateStatus() {
  const previous = currentStatus;
  currentStatus = computeStatus();

  if (previous?.isOnline !== currentStatus.isOnline) {
    currentStatus.since = Date.now();
  }

  notifyListeners();
}

export function initNetworkStatus(): NetworkStatus {
  if (currentStatus) return currentStatus;

  currentStatus = computeStatus();

  window.addEventListener('online', updateStatus);
  window.addEventListener('offline', updateStatus);

  const nav = navigator as Navigator & {
    connection?: {
      addEventListener?: (type: string, handler: () => void) => void;
      removeEventListener?: (type: string, handler: () => void) => void;
    };
  };

  if (nav.connection?.addEventListener) {
    nav.connection.addEventListener('change', updateStatus);
  }

  return currentStatus;
}

export function getNetworkStatus(): NetworkStatus {
  return currentStatus ?? initNetworkStatus();
}

export function subscribeNetworkStatus(listener: NetworkChangeListener): () => void {
  if (!currentStatus) initNetworkStatus();
  listeners.add(listener);
  if (currentStatus) {
    try {
      listener(currentStatus);
    } catch (err) {
      console.error('[Network] Initial listener error:', err);
    }
  }
  return () => listeners.delete(listener);
}

export function isOnline(): boolean {
  return getNetworkStatus().isOnline;
}

export function waitForOnline(timeoutMs = 30000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isOnline()) {
      resolve();
      return;
    }

    let unsubscribe: (() => void) | null = null;
    const timer = setTimeout(() => {
      if (unsubscribe) unsubscribe();
      reject(new Error('Timeout waiting for network connection'));
    }, timeoutMs);

    unsubscribe = subscribeNetworkStatus((status) => {
      if (status.isOnline) {
        clearTimeout(timer);
        if (unsubscribe) unsubscribe();
        resolve();
      }
    });
  });
}

export async function pingCheck(url = '/favicon.svg'): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, {
      method: 'HEAD',
      cache: 'no-store',
      signal: controller.signal,
    });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}
