export interface Frame {
  id: string;
  imageData: ImageData;
  delay: number;
  width: number;
  height: number;
  disposalMethod: number;
}

export interface Caption {
  id: string;
  text: string;
  frameRange: [number, number];
  x: number;
  y: number;
  fontSize: number;
  fontFamily: string;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  align: 'left' | 'center' | 'right';
}

export interface CropConfig {
  enabled: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportConfig {
  colors: number;
  quality: number;
  fps: number;
  dither: boolean;
  repeat: number;
  width: number;
  height: number;
}

export interface EditorState {
  frames: Frame[];
  selectedFrameIndex: number;
  captions: Caption[];
  crop: CropConfig;
  exportConfig: ExportConfig;
  isPlaying: boolean;
  playbackSpeed: number;
  currentFrameIndex: number;
  canvasWidth: number;
  canvasHeight: number;
}

export interface SerializedFrame {
  id: string;
  imageDataBase64: string;
  delay: number;
  width: number;
  height: number;
  disposalMethod: number;
}

export interface Project {
  id: string;
  name: string;
  frames: SerializedFrame[];
  captions: Caption[];
  crop: CropConfig;
  exportConfig: ExportConfig;
  selectedFrameIndex: number;
  currentFrameIndex: number;
  canvasWidth: number;
  canvasHeight: number;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
  isDirty: boolean;
}

export interface ProjectMeta {
  id: string;
  name: string;
  frameCount: number;
  thumbnail?: string;
  createdAt: number;
  updatedAt: number;
  syncedAt?: number;
  isDirty: boolean;
}

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

export type OperationType =
  | 'project.create'
  | 'project.update'
  | 'project.delete'
  | 'frame.add'
  | 'frame.delete'
  | 'frame.update'
  | 'frame.reorder'
  | 'caption.add'
  | 'caption.update'
  | 'caption.delete';

export interface SyncOperation {
  id: string;
  type: OperationType;
  projectId: string;
  payload: unknown;
  timestamp: number;
  retries: number;
  status: 'pending' | 'processing' | 'failed' | 'completed';
  error?: string;
}

export interface NetworkStatus {
  isOnline: boolean;
  wasOffline: boolean;
  since: number;
  downlink?: number;
  effectiveType?: string;
}

export interface PersistedState {
  activeProjectId: string | null;
  recentProjectIds: string[];
  lastSavedAt: number;
}
