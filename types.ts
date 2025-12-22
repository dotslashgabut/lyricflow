
export interface SubtitleSegment {
  start: number; // Start time in seconds
  end: number;   // End time in seconds
  text: string;  // The content text
}

export enum AppState {
  IDLE = 'IDLE',
  RECORDING = 'RECORDING',
  READY = 'READY',
  PROCESSING = 'PROCESSING',
  EXPORTING = 'EXPORTING',
  COMPLETED = 'COMPLETED',
  ERROR = 'ERROR'
}

export type AudioSource = 'upload' | 'microphone';

export type AspectRatio = '16:9' | '9:16' | '3:4';
