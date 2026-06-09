import { create } from 'zustand';
import { projectsDB, projectMetaDB, appStateDB, isIndexedDBSupported } from '@/lib/offline/indexedDB';
import { enqueueOperation, subscribeSyncStatus, initSyncManager, triggerSync } from '@/lib/offline/syncManager';
import { cacheEditState, requestEditState, subscribeSWMessages } from '@/lib/offline/serviceWorker';
import { initNetworkStatus, subscribeNetworkStatus } from '@/lib/offline/network';
import type { Project, ProjectMeta, PersistedState, SyncStatus, NetworkStatus, SerializedFrame, Frame } from '@/types';

function imageDataToBase64(imageData: ImageData): string {
  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

function base64ToImageData(base64: string, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new ImageData(width, height);

  const img = new Image();
  img.src = base64;
  if (img.complete) {
    ctx.drawImage(img, 0, 0);
  }
  return ctx.getImageData(0, 0, width, height);
}

export function serializeFrames(frames: Frame[]): SerializedFrame[] {
  return frames.map((f) => ({
    id: f.id,
    imageDataBase64: imageDataToBase64(f.imageData),
    delay: f.delay,
    width: f.width,
    height: f.height,
    disposalMethod: f.disposalMethod,
  }));
}

export function deserializeFrames(serialized: SerializedFrame[]): Frame[] {
  return serialized.map((f) => ({
    id: f.id,
    imageData: base64ToImageData(f.imageDataBase64, f.width, f.height),
    delay: f.delay,
    width: f.width,
    height: f.height,
    disposalMethod: f.disposalMethod,
  }));
}

function generateId(): string {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

interface OfflineStoreState {
  isInitialized: boolean;
  projects: ProjectMeta[];
  activeProjectId: string | null;
  activeProject: Project | null;
  recentProjectIds: string[];
  syncStatus: SyncStatus;
  syncPendingCount: number;
  networkStatus: NetworkStatus | null;
  lastSavedAt: number | null;
  initError: string | null;

  initialize: () => Promise<void>;
  loadProjects: () => Promise<void>;
  createProject: (name?: string) => Promise<Project>;
  loadProject: (id: string) => Promise<Project | null>;
  saveProject: (project: Omit<Project, 'id' | 'createdAt' | 'updatedAt' | 'syncedAt' | 'isDirty'> & { id?: string; createdAt?: number }) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  setActiveProjectId: (id: string | null) => void;
  cacheEditStateToSW: (projectId: string | undefined, state: unknown) => void;
  requestCachedEditState: (projectId: string | undefined) => void;
  manualSync: () => Promise<void>;
}

export const useOfflineStore = create<OfflineStoreState>((set, get) => ({
  isInitialized: false,
  projects: [],
  activeProjectId: null,
  activeProject: null,
  recentProjectIds: [],
  syncStatus: 'idle',
  syncPendingCount: 0,
  networkStatus: null,
  lastSavedAt: null,
  initError: null,

  initialize: async () => {
    if (get().isInitialized) return;

    try {
      if (!isIndexedDBSupported()) {
        set({ initError: 'IndexedDB is not supported in this browser' });
        return;
      }

      initNetworkStatus();
      subscribeNetworkStatus((status) => {
        set({ networkStatus: status });
      });

      subscribeSyncStatus((status, pendingCount) => {
        set({ syncStatus: status, syncPendingCount: pendingCount });
      });

      subscribeSWMessages((message) => {
        if (message.type === 'EDIT_STATE_RESTORED') {
          console.log('[Offline] Edit state restored from SW cache');
        }
      });

      await initSyncManager();

      const persisted = await appStateDB.getPersistedState();
      if (persisted) {
        set({
          activeProjectId: persisted.activeProjectId,
          recentProjectIds: persisted.recentProjectIds,
          lastSavedAt: persisted.lastSavedAt,
        });
      }

      await get().loadProjects();

      set({ isInitialized: true, networkStatus: initNetworkStatus() });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Initialization failed';
      console.error('[Offline] Init error:', err);
      set({ initError: errorMessage });
    }
  },

  loadProjects: async () => {
    try {
      const projects = await projectMetaDB.list();
      set({ projects });
    } catch (err) {
      console.error('[Offline] Failed to load projects:', err);
    }
  },

  createProject: async (name = '未命名项目') => {
    const now = Date.now();
    const project: Project = {
      id: generateId(),
      name,
      frames: [],
      captions: [],
      crop: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
      exportConfig: { colors: 256, quality: 80, fps: 15, dither: true, repeat: 0, width: 0, height: 0 },
      selectedFrameIndex: -1,
      currentFrameIndex: 0,
      canvasWidth: 640,
      canvasHeight: 480,
      createdAt: now,
      updatedAt: now,
      isDirty: true,
    };

    await projectsDB.save(project);

    const meta: ProjectMeta = {
      id: project.id,
      name: project.name,
      frameCount: 0,
      createdAt: now,
      updatedAt: now,
      isDirty: true,
    };
    await projectMetaDB.save(meta);

    await enqueueOperation('project.create', project.id, project);

    const state = get();
    const newRecent = [project.id, ...state.recentProjectIds.filter((id) => id !== project.id)].slice(0, 10);
    await appStateDB.savePersistedState({
      activeProjectId: project.id,
      recentProjectIds: newRecent,
      lastSavedAt: Date.now(),
    });

    set({
      activeProjectId: project.id,
      activeProject: project,
      recentProjectIds: newRecent,
      projects: [meta, ...state.projects],
      lastSavedAt: Date.now(),
    });

    return project;
  },

  loadProject: async (id: string) => {
    try {
      const project = await projectsDB.get(id);
      if (!project) return null;

      const state = get();
      const newRecent = [id, ...state.recentProjectIds.filter((pId) => pId !== id)].slice(0, 10);

      await appStateDB.savePersistedState({
        activeProjectId: id,
        recentProjectIds: newRecent,
        lastSavedAt: Date.now(),
      });

      set({
        activeProjectId: id,
        activeProject: project,
        recentProjectIds: newRecent,
        lastSavedAt: Date.now(),
      });

      return project;
    } catch (err) {
      console.error('[Offline] Failed to load project:', err);
      return null;
    }
  },

  saveProject: async (projectData) => {
    const now = Date.now();
    const existing = projectData.id ? await projectsDB.get(projectData.id) : null;

    const project: Project = {
      id: projectData.id || generateId(),
      name: projectData.name,
      frames: projectData.frames,
      captions: projectData.captions,
      crop: projectData.crop,
      exportConfig: projectData.exportConfig,
      selectedFrameIndex: projectData.selectedFrameIndex,
      currentFrameIndex: projectData.currentFrameIndex,
      canvasWidth: projectData.canvasWidth,
      canvasHeight: projectData.canvasHeight,
      createdAt: projectData.createdAt || existing?.createdAt || now,
      updatedAt: now,
      syncedAt: existing?.syncedAt,
      isDirty: true,
    };

    await projectsDB.save(project);

    const existingMeta = project.id ? await projectMetaDB.get(project.id) : null;
    const meta: ProjectMeta = {
      id: project.id,
      name: project.name,
      frameCount: project.frames.length,
      thumbnail: existingMeta?.thumbnail,
      createdAt: existingMeta?.createdAt || project.createdAt,
      updatedAt: now,
      syncedAt: existingMeta?.syncedAt,
      isDirty: true,
    };
    await projectMetaDB.save(meta);

    const opType: 'project.create' | 'project.update' = existing ? 'project.update' : 'project.create';
    await enqueueOperation(opType, project.id, project);

    const state = get();
    const newRecent = [project.id, ...state.recentProjectIds.filter((pId) => pId !== project.id)].slice(0, 10);

    await appStateDB.savePersistedState({
      activeProjectId: state.activeProjectId,
      recentProjectIds: newRecent,
      lastSavedAt: now,
    });

    set({
      activeProject: project,
      projects: state.projects.map((m) => (m.id === project.id ? meta : m)),
      recentProjectIds: newRecent,
      lastSavedAt: now,
    });
  },

  deleteProject: async (id: string) => {
    await projectsDB.delete(id);
    await projectMetaDB.delete(id);
    await enqueueOperation('project.delete', id, id);

    const state = get();
    const newActiveId = state.activeProjectId === id ? null : state.activeProjectId;
    const newRecent = state.recentProjectIds.filter((pId) => pId !== id);

    await appStateDB.savePersistedState({
      activeProjectId: newActiveId,
      recentProjectIds: newRecent,
      lastSavedAt: Date.now(),
    });

    set({
      activeProjectId: newActiveId,
      activeProject: newActiveId ? state.activeProject : null,
      projects: state.projects.filter((m) => m.id !== id),
      recentProjectIds: newRecent,
      lastSavedAt: Date.now(),
    });
  },

  setActiveProjectId: (id: string | null) => {
    set({ activeProjectId: id });
  },

  cacheEditStateToSW: (projectId, state) => {
    cacheEditState(projectId, state);
  },

  requestCachedEditState: (projectId) => {
    requestEditState(projectId);
  },

  manualSync: async () => {
    await triggerSync();
  },
}));
