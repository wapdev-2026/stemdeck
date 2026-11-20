export type StemCategory =
  | 'Vocals'
  | 'Background'
  | 'Drums'
  | 'Bass'
  | 'Guitar'
  | 'Keys'
  | 'Synth'
  | 'Other';

export interface AcousticProfile {
  rmsDb: number;
  peakDb: number;
  crestFactorDb: number;
  zeroCrossingRate: number;
  lowEnergyRatio: number;
  midEnergyRatio: number;
  highEnergyRatio: number;
}

export interface StemClassification {
  id: string;
  category: StemCategory;
  displayName: string;
  characterNote: string;
}

export interface Stem {
  id: string;
  name: string; // AI or user display name (e.g. "Vocals", "Background Vocals", "Drums")
  rawName: string; // Original filename without extension
  fileName: string;
  buffer: AudioBuffer;
  peaks: number[];
  volume: number; // 0 to 1.5 (0% to 150%)
  muted: boolean;
  soloed: boolean;
  color: string;
  duration: number;
  sampleRate: number;
  numberOfChannels: number;
  category?: StemCategory;
  characterNote?: string;
  isClassifying?: boolean;
  acousticProfile: AcousticProfile;
}

export interface ImportError {
  id: string;
  fileName: string;
  message: string;
}

export interface ExportSummary {
  fileName: string;
  clipped: boolean;
  originalPeak: number;
  dbRemoved: number;
  preventClippingApplied: boolean;
  duration: number;
  sampleRate: number;
  timestamp: string;
}
