export interface SWRegistrationOptions {
  onUpdateAvailable?: (registration: ServiceWorkerRegistration) => void;
  onRegistered?: (registration: ServiceWorkerRegistration) => void;
  onError?: (error: Error) => void;
}

type SWMessageListener = (message: { type: string; payload?: unknown }) => void;

let registration: ServiceWorkerRegistration | null = null;
const messageListeners = new Set<SWMessageListener>();
let isListening = false;

function setupMessageListener() {
  if (isListening) return;
  isListening = true;

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener('message', (event) => {
      const data = event.data;
      if (!data || !data.type) return;
      for (const listener of messageListeners) {
        try {
          listener(data);
        } catch (err) {
          console.error('[SW] Message listener error:', err);
        }
      }
    });
  }
}

export function isServiceWorkerSupported(): boolean {
  return 'serviceWorker' in navigator;
}

export async function registerServiceWorker(
  swPath = '/sw.js',
  options: SWRegistrationOptions = {}
): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) {
    const err = new Error('Service Worker is not supported in this browser');
    options.onError?.(err);
    return null;
  }

  setupMessageListener();

  try {
    registration = await navigator.serviceWorker.register(swPath, {
      scope: '/',
      updateViaCache: 'imports',
    });

    options.onRegistered?.(registration);

    if (registration.waiting) {
      options.onUpdateAvailable?.(registration);
    }

    registration.addEventListener('updatefound', () => {
      const newWorker = registration?.installing;
      if (!newWorker) return;

      newWorker.addEventListener('statechange', () => {
        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
          options.onUpdateAvailable?.(registration!);
        }
      });
    });

    return registration;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    console.error('[SW] Registration failed:', error);
    options.onError?.(error);
    return null;
  }
}

export function getRegistration(): ServiceWorkerRegistration | null {
  return registration;
}

export async function getReadyRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!isServiceWorkerSupported()) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch {
    return null;
  }
}

function postMessage(type: string, payload?: unknown) {
  const target = registration?.active ?? registration?.waiting ?? registration?.installing;
  if (target) {
    target.postMessage({ type, payload });
    return true;
  }
  return false;
}

export function subscribeSWMessages(listener: SWMessageListener): () => void {
  setupMessageListener();
  messageListeners.add(listener);
  return () => messageListeners.delete(listener);
}

export function cacheEditState(projectId: string | undefined, state: unknown): boolean {
  return postMessage('CACHE_EDIT_STATE', { projectId, state });
}

export function requestEditState(projectId: string | undefined): boolean {
  return postMessage('GET_EDIT_STATE', { projectId });
}

export function clearEditState(projectId: string | undefined): boolean {
  return postMessage('CLEAR_EDIT_STATE', { projectId });
}

export function clearRuntimeCache(): boolean {
  return postMessage('CLEAR_RUNTIME_CACHE');
}

export function getCacheStats(): boolean {
  return postMessage('GET_CACHE_STATS');
}

export function skipWaiting(): boolean {
  return postMessage('SKIP_WAITING');
}

export async function requestBackgroundSync(tag: string): Promise<boolean> {
  const reg = await getReadyRegistration();
  if (!reg || !('sync' in reg)) return false;
  try {
    await (reg as ServiceWorkerRegistration & {
      sync: { register: (tag: string) => Promise<void> };
    }).sync.register(tag);
    return true;
  } catch (err) {
    console.warn('[SW] Background sync registration failed:', err);
    return false;
  }
}

export async function updateServiceWorker(): Promise<void> {
  if (registration) {
    try {
      await registration.update();
    } catch (err) {
      console.warn('[SW] Update check failed:', err);
    }
  }
}
