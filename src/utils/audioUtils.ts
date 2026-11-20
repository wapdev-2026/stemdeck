import JSZip from 'jszip';
import {
  AcousticProfile,
  ExportSummary,
  ImportError,
  Stem,
  StemCategory,
  StemClassification,
} from '../types/stem';

export const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'wav', 'm4a', 'flac', 'ogg'];

export const STEM_COLORS = [
  '#6366f1', // Indigo
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#14b8a6', // Teal
  '#f97316', // Orange
];

export const CATEGORY_COLORS: Record<StemCategory, string> = {
  Vocals: '#ec4899', // Pink / Rose
  Background: '#8b5cf6', // Violet
  Drums: '#f59e0b', // Amber
  Bass: '#6366f1', // Indigo
  Guitar: '#0ea5e9', // Sky
  Keys: '#10b981', // Emerald
  Synth: '#14b8a6', // Teal
  Other: '#64748b', // Slate
};

export const VOLUME_PRESETS = [10, 15, 25, 50, 75, 100, 125, 150];

export function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function isSupportedAudioFile(filename: string): boolean {
  const ext = getExtension(filename);
  return SUPPORTED_AUDIO_EXTENSIONS.includes(ext);
}

export function stripExtension(filepath: string): string {
  const normalized = filepath.replace(/\\/g, '/');
  const base = normalized.split('/').pop() || filepath;
  const lastDot = base.lastIndexOf('.');
  if (lastDot <= 0) return base;
  return base.slice(0, lastDot);
}

export function isIgnoredZipEntry(entryPath: string, isDir: boolean): boolean {
  if (isDir) return true;
  const normalized = entryPath.replace(/\\/g, '/');
  if (normalized.includes('__MACOSX/')) return true;
  const segments = normalized.split('/');
  const base = segments[segments.length - 1];
  if (!base || base.startsWith('.') || base.startsWith('._')) return true;
  return !isSupportedAudioFile(base);
}

/**
 * Computes normalized peak values [0..1] across the full duration of an AudioBuffer.
 */
export function computePeaks(buffer: AudioBuffer, bucketCount = 480): number[] {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  if (length === 0 || bucketCount <= 0) {
    return new Array(bucketCount).fill(0);
  }

  const samplesPerBucket = Math.max(1, Math.floor(length / bucketCount));
  const peaks: number[] = new Array(bucketCount).fill(0);
  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) {
    channelData.push(buffer.getChannelData(c));
  }

  const step = Math.max(1, Math.floor(samplesPerBucket / 64));

  let globalMax = 0;
  for (let i = 0; i < bucketCount; i++) {
    const start = i * samplesPerBucket;
    const end = i === bucketCount - 1 ? length : Math.min(length, start + samplesPerBucket);
    let maxInBucket = 0;

    for (let s = start; s < end; s += step) {
      for (let c = 0; c < channels; c++) {
        const val = Math.abs(channelData[c][s]);
        if (val > maxInBucket) {
          maxInBucket = val;
        }
      }
    }
    peaks[i] = maxInBucket;
    if (maxInBucket > globalMax) {
      globalMax = maxInBucket;
    }
  }

  if (globalMax > 1.0) {
    for (let i = 0; i < bucketCount; i++) {
      peaks[i] = peaks[i] / globalMax;
    }
  }

  return peaks;
}

/**
 * Computes an acoustic telemetry profile (RMS, peak, transient crest factor, ZCR, and 3-band spectral ratios)
 * from an AudioBuffer to assist AI stem recognition.
 */
export function computeAcousticProfile(buffer: AudioBuffer): AcousticProfile {
  const ch0 = buffer.getChannelData(0);
  const len = ch0.length;
  const sr = buffer.sampleRate || 44100;

  if (len === 0) {
    return {
      rmsDb: -60,
      peakDb: -60,
      crestFactorDb: 0,
      zeroCrossingRate: 0,
      lowEnergyRatio: 0.33,
      midEnergyRatio: 0.34,
      highEnergyRatio: 0.33,
    };
  }

  const stride = Math.max(1, Math.floor(len / 48000));
  let sumSq = 0;
  let peak = 0;
  let zeroCrossings = 0;
  let count = 0;

  // Simple 1-pole low-pass and high-pass filter state to estimate low/mid/high spectral distribution
  let lowState = 0;
  let midLowState = 0;
  const alphaLow = Math.min(0.9, (2 * Math.PI * 250) / (sr / stride));
  const alphaMid = Math.min(0.95, (2 * Math.PI * 2500) / (sr / stride));

  let lowEnergy = 0;
  let midEnergy = 0;
  let highEnergy = 0;
  let prevSample = 0;

  for (let i = 0; i < len; i += stride) {
    const s = ch0[i];
    const abs = Math.abs(s);
    if (abs > peak) peak = abs;
    sumSq += s * s;

    if ((s >= 0 && prevSample < 0) || (s < 0 && prevSample >= 0)) {
      zeroCrossings++;
    }
    prevSample = s;

    lowState += alphaLow * (s - lowState);
    midLowState += alphaMid * (s - midLowState);

    const lowComp = lowState;
    const midComp = midLowState - lowState;
    const highComp = s - midLowState;

    lowEnergy += lowComp * lowComp;
    midEnergy += midComp * midComp;
    highEnergy += highComp * highComp;
    count++;
  }

  const rms = Math.sqrt(sumSq / Math.max(1, count));
  const rmsDb = 20 * Math.log10(Math.max(1e-5, rms));
  const peakDb = 20 * Math.log10(Math.max(1e-5, peak));
  const crestFactorDb = Math.max(0, peakDb - rmsDb);
  const analyzedDuration = (count * stride) / sr;
  const zeroCrossingRate = analyzedDuration > 0 ? zeroCrossings / (2 * analyzedDuration) : 0;

  const totalBandEnergy = Math.max(1e-9, lowEnergy + midEnergy + highEnergy);
  return {
    rmsDb,
    peakDb,
    crestFactorDb,
    zeroCrossingRate,
    lowEnergyRatio: lowEnergy / totalBandEnergy,
    midEnergyRatio: midEnergy / totalBandEnergy,
    highEnergyRatio: highEnergy / totalBandEnergy,
  };
}

/**
 * Extracts a compact 2-second 8 kHz mono 16-bit WAV audio snippet from the most active window
 * of the AudioBuffer, encoded as Base64 for multimodal Gemini analysis.
 */
export function extractAudioSnippetBase64(buffer: AudioBuffer): string {
  const ch0 = buffer.getChannelData(0);
  const sr = buffer.sampleRate || 44100;
  const len = ch0.length;
  if (len === 0) return '';

  const windowSec = Math.min(2.0, buffer.duration);
  const windowSamples = Math.max(1, Math.floor(windowSec * sr));

  // Find the loudest window across up to 8 candidate positions
  let bestStart = 0;
  let bestEnergy = -1;
  const steps = 8;
  for (let w = 0; w < steps; w++) {
    const start = Math.floor((w / steps) * Math.max(0, len - windowSamples));
    let energy = 0;
    const checkStride = Math.max(1, Math.floor(windowSamples / 500));
    for (let i = 0; i < windowSamples && start + i < len; i += checkStride) {
      const v = ch0[start + i];
      energy += v * v;
    }
    if (energy > bestEnergy) {
      bestEnergy = energy;
      bestStart = start;
    }
  }

  const targetSr = 8000;
  const ratio = sr / targetSr;
  const outFrames = Math.max(1, Math.floor(windowSamples / ratio));
  const dataSize = outFrames * 2;
  const wavBuf = new ArrayBuffer(44 + dataSize);
  const view = new DataView(wavBuf);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, targetSr, true);
  view.setUint32(28, targetSr * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < outFrames; i++) {
    const srcIdx = Math.min(len - 1, bestStart + Math.floor(i * ratio));
    const sample = Math.max(-1, Math.min(1, ch0[srcIdx]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  const bytes = new Uint8Array(wavBuf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Calls the server-side Gemini endpoint (/api/classify-stems) to intelligently identify each stem role
 * (e.g. Vocals, Background Vocals, Drums, Bass, Keys, Guitar).
 */
export async function classifyStemsWithAI(stems: Stem[]): Promise<StemClassification[]> {
  const payload = {
    stems: stems.map((stem) => ({
      id: stem.id,
      fileName: stem.fileName,
      rawName: stem.rawName,
      duration: stem.duration,
      channels: stem.numberOfChannels,
      acousticProfile: stem.acousticProfile,
      audioSnippetBase64: extractAudioSnippetBase64(stem.buffer),
    })),
  };

  const response = await fetch('/api/classify-stems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `AI classification failed with status ${response.status}`);
  }

  return Array.isArray(data.classifications) ? data.classifications : [];
}

export interface RawAudioCandidate {
  fileName: string;
  stemName: string;
  getArrayBuffer: () => Promise<ArrayBuffer>;
}

/**
 * Unpacks selected files (including .zip archives from Moises) into raw audio candidates
 * and collects descriptive user-facing errors for unsupported or corrupt files.
 */
export async function extractAudioCandidates(
  fileList: FileList | File[]
): Promise<{ candidates: RawAudioCandidate[]; errors: ImportError[] }> {
  const files = Array.from(fileList);
  const candidates: RawAudioCandidate[] = [];
  const errors: ImportError[] = [];

  for (const file of files) {
    const ext = getExtension(file.name);

    if (ext === 'zip' || file.type === 'application/zip' || file.type === 'application/x-zip-compressed') {
      try {
        const zip = await JSZip.loadAsync(file);
        let foundAudioInZip = 0;

        const entries = Object.values(zip.files);
        for (const entry of entries) {
          if (isIgnoredZipEntry(entry.name, entry.dir)) {
            continue;
          }
          foundAudioInZip++;
          const baseName = entry.name.replace(/\\/g, '/').split('/').pop() || entry.name;
          candidates.push({
            fileName: `${file.name} → ${baseName}`,
            stemName: stripExtension(baseName),
            getArrayBuffer: () => entry.async('arraybuffer'),
          });
        }

        if (foundAudioInZip === 0) {
          errors.push({
            id: `${Date.now()}-${Math.random()}`,
            fileName: file.name,
            message: `No supported audio files found inside "${file.name}". Ensure the ZIP archive contains MP3, WAV, M4A, FLAC or OGG stems.`,
          });
        }
      } catch {
        errors.push({
          id: `${Date.now()}-${Math.random()}`,
          fileName: file.name,
          message: `Could not unpack "${file.name}". Ensure it is a valid ZIP archive exported from Moises.`,
        });
      }
    } else if (isSupportedAudioFile(file.name)) {
      candidates.push({
        fileName: file.name,
        stemName: stripExtension(file.name),
        getArrayBuffer: () => file.arrayBuffer(),
      });
    } else {
      errors.push({
        id: `${Date.now()}-${Math.random()}`,
        fileName: file.name,
        message: `Could not load "${file.name}". Use MP3, WAV, M4A, FLAC, OGG, or a Moises .zip archive.`,
      });
    }
  }

  return { candidates, errors };
}

export function formatTime(seconds: number, includeTenths = false): string {
  if (!Number.isFinite(seconds) || seconds < 0) return includeTenths ? '0:00.0' : '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const tenths = Math.floor((seconds % 1) * 10);
  const paddedSecs = secs < 10 ? `0${secs}` : `${secs}`;
  return includeTenths ? `${mins}:${paddedSecs}.${tenths}` : `${mins}:${paddedSecs}`;
}

export function isStemAudible(stem: Stem, anySoloed: boolean): boolean {
  if (anySoloed) {
    return stem.soloed;
  }
  return !stem.muted;
}

export function getEffectiveStemGain(stem: Stem, anySoloed: boolean): number {
  return isStemAudible(stem, anySoloed) ? stem.volume : 0;
}

/**
 * Produces a concise, readable stem token for filenames (e.g., "b.vocals", "vocals", "drums", "bass", "keys").
 */
export function getCompactStemToken(stem: Stem): string {
  const combined = `${stem.name} ${stem.rawName}`.toLowerCase();

  if (
    stem.category === 'Background' ||
    combined.includes('background') ||
    combined.includes('backing') ||
    combined.includes('bgv') ||
    combined.includes('harmon') ||
    combined.includes('choir')
  ) {
    return 'b.vocals';
  }

  if (
    stem.category === 'Vocals' ||
    combined.includes('vocal') ||
    combined.includes('vox') ||
    combined.includes('voice')
  ) {
    return 'vocals';
  }

  if (
    stem.category === 'Drums' ||
    combined.includes('drum') ||
    combined.includes('kit') ||
    combined.includes('perc')
  ) {
    if (combined.includes('perc') && !combined.includes('drum')) {
      return 'perc';
    }
    return 'drums';
  }

  if (stem.category === 'Bass' || combined.includes('bass')) {
    return 'bass';
  }

  if (stem.category === 'Guitar' || combined.includes('guitar') || combined.includes('gtr')) {
    if (combined.includes('acoustic')) return 'a.guitar';
    if (combined.includes('electric')) return 'e.guitar';
    if (combined.includes('rhythm')) return 'r.guitar';
    if (combined.includes('lead')) return 'l.guitar';
    return 'guitar';
  }

  if (
    stem.category === 'Keys' ||
    combined.includes('key') ||
    combined.includes('piano') ||
    combined.includes('organ') ||
    combined.includes('rhodes')
  ) {
    if (combined.includes('piano')) return 'piano';
    if (combined.includes('organ')) return 'organ';
    return 'keys';
  }

  if (
    stem.category === 'Synth' ||
    combined.includes('synth') ||
    combined.includes('string') ||
    combined.includes('pad')
  ) {
    if (combined.includes('string')) return 'strings';
    if (combined.includes('pad')) return 'pad';
    return 'synth';
  }

  const cleaned = stem.name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '')
    .slice(0, 12);
  return cleaned || 'stem';
}

/**
 * Builds an intelligent export filename containing the current stem mix settings,
 * placing modified stem percentages first (e.g., "b.vocals10%_vocals100%_drums100%_bass100%.wav").
 */
export function buildMixdownFilename(stems: Stem[]): string {
  if (stems.length === 0) return 'mixdown.wav';

  const anySoloed = stems.some((s) => s.soloed);

  // Count token occurrences to disambiguate identical stem roles (e.g., guitar1, guitar2)
  const rawTokens = stems.map((s) => getCompactStemToken(s));
  const counts = new Map<string, number>();
  for (const t of rawTokens) {
    counts.set(t, (counts.get(t) || 0) + 1);
  }
  const seen = new Map<string, number>();

  const descriptors = stems.map((stem, index) => {
    const baseToken = rawTokens[index];
    let token = baseToken;
    if ((counts.get(baseToken) || 0) > 1) {
      const nextNum = (seen.get(baseToken) || 0) + 1;
      seen.set(baseToken, nextNum);
      token = `${baseToken}${nextNum}`;
    }

    const audible = isStemAudible(stem, anySoloed);
    const percent = audible ? Math.round(stem.volume * 100) : 0;
    const isModified = percent !== 100 || stem.soloed || stem.muted;

    return {
      token,
      percent,
      isModified,
      index,
      part: `${token}${percent}%`,
    };
  });

  // Sort so stems with customized settings (e.g., b.vocals10%, muted 0%, soloed) lead the filename
  descriptors.sort((a, b) => {
    if (a.isModified !== b.isModified) {
      return a.isModified ? -1 : 1;
    }
    return a.index - b.index;
  });

  // Check if all stems came from a single ZIP archive prefix ("SongName.zip → ...")
  let zipPrefix = '';
  const firstArrow = stems[0].fileName.indexOf(' → ');
  if (firstArrow > 0) {
    const candidateZip = stems[0].fileName.slice(0, firstArrow);
    const allSameZip = stems.every((s) => s.fileName.startsWith(`${candidateZip} → `));
    if (allSameZip) {
      zipPrefix = stripExtension(candidateZip)
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    }
  }

  const settingsSegment = descriptors.map((d) => d.part).join('_');
  const baseName = zipPrefix ? `${zipPrefix}_${settingsSegment}` : settingsSegment;
  return `${baseName}.wav`;
}

export async function exportMixdownWav(
  stems: Stem[],
  preventClipping: boolean
): Promise<{ blob: Blob; summary: ExportSummary }> {
  if (stems.length === 0) {
    throw new Error('No stems loaded to export.');
  }

  const anySoloed = stems.some((s) => s.soloed);
  const maxDuration = Math.max(...stems.map((s) => s.buffer.duration));
  const sampleRate = Math.max(...stems.map((s) => s.buffer.sampleRate), 44100);
  const totalFrames = Math.max(1, Math.ceil(maxDuration * sampleRate));

  const offlineCtx = new OfflineAudioContext(2, totalFrames, sampleRate);

  for (const stem of stems) {
    const effectiveGain = getEffectiveStemGain(stem, anySoloed);
    if (effectiveGain <= 0) continue;

    const source = offlineCtx.createBufferSource();
    source.buffer = stem.buffer;

    const gainNode = offlineCtx.createGain();
    gainNode.gain.setValueAtTime(effectiveGain, 0);

    source.connect(gainNode);
    gainNode.connect(offlineCtx.destination);
    source.start(0, 0);
  }

  const renderedBuffer = await offlineCtx.startRendering();
  const left = renderedBuffer.getChannelData(0);
  const right =
    renderedBuffer.numberOfChannels > 1
      ? renderedBuffer.getChannelData(1)
      : renderedBuffer.getChannelData(0);

  const numFrames = renderedBuffer.length;
  let maxPeak = 0;

  for (let i = 0; i < numFrames; i++) {
    const absL = Math.abs(left[i]);
    const absR = Math.abs(right[i]);
    if (absL > maxPeak) maxPeak = absL;
    if (absR > maxPeak) maxPeak = absR;
  }

  const TARGET_CEILING = 0.98;
  const clipped = maxPeak > 1.0;
  let gainScale = 1.0;
  let dbRemoved = 0;
  let preventClippingApplied = false;

  if (clipped && preventClipping) {
    gainScale = TARGET_CEILING / maxPeak;
    dbRemoved = 20 * Math.log10(maxPeak / TARGET_CEILING);
    preventClippingApplied = true;
  }

  const wavBuffer = encodeStereoPcm16Wav(left, right, sampleRate, gainScale);
  const blob = new Blob([wavBuffer], { type: 'audio/wav' });
  const fileName = buildMixdownFilename(stems);

  return {
    blob,
    summary: {
      fileName,
      clipped,
      originalPeak: maxPeak,
      dbRemoved,
      preventClippingApplied,
      duration: maxDuration,
      sampleRate,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    },
  };
}

function encodeStereoPcm16Wav(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  gainScale: number
): ArrayBuffer {
  const numChannels = 2;
  const bytesPerSample = 2;
  const numFrames = left.length;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const sampleL = Math.max(-1, Math.min(1, left[i] * gainScale));
    const sampleR = Math.max(-1, Math.min(1, right[i] * gainScale));

    view.setInt16(offset, sampleL < 0 ? sampleL * 0x8000 : sampleL * 0x7fff, true);
    offset += 2;
    view.setInt16(offset, sampleR < 0 ? sampleR * 0x8000 : sampleR * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

/**
 * Generates a realistic 4-stem multitrack session (Vocals, Background Vocals, Drums, Bass)
 * so users can test AI stem recognition, sample-accurate playback, solo/mute, and WAV export.
 */
export function createDemoStems(ctx: AudioContext, existingCount = 0): Stem[] {
  const sampleRate = ctx.sampleRate || 44100;
  const bpm = 110;
  const beatsPerBar = 4;
  const bars = 4;
  const totalBeats = beatsPerBar * bars;
  const beatDuration = 60 / bpm;
  const duration = totalBeats * beatDuration;
  const length = Math.floor(duration * sampleRate);

  // 1. Vocals (Lead vocal melody)
  const leadBuffer = ctx.createBuffer(2, length, sampleRate);
  const leadL = leadBuffer.getChannelData(0);
  const leadR = leadBuffer.getChannelData(1);
  const melody: Array<{ beat: number; dur: number; freq: number }> = [
    { beat: 0.5, dur: 1.0, freq: 440.0 },
    { beat: 1.5, dur: 1.0, freq: 523.25 },
    { beat: 2.5, dur: 1.25, freq: 659.25 },
    { beat: 4.5, dur: 1.5, freq: 587.33 },
    { beat: 6.0, dur: 1.75, freq: 523.25 },
    { beat: 8.5, dur: 1.0, freq: 659.25 },
    { beat: 9.5, dur: 1.0, freq: 783.99 },
    { beat: 10.5, dur: 1.25, freq: 659.25 },
    { beat: 12.0, dur: 1.5, freq: 587.33 },
    { beat: 13.5, dur: 2.25, freq: 440.0 },
  ];

  for (const note of melody) {
    const startSample = Math.floor(note.beat * beatDuration * sampleRate);
    const noteSamples = Math.floor(note.dur * beatDuration * sampleRate);

    for (let i = 0; i < noteSamples && startSample + i < length; i++) {
      const t = i / sampleRate;
      const totalT = noteSamples / sampleRate;
      const attack = Math.min(1, t / 0.04);
      const release = Math.min(1, (totalT - t) / 0.08);
      const vibrato = Math.sin(2 * Math.PI * 5.5 * t) * 2.5 * Math.min(1, t / 0.25);
      const instFreq = note.freq + vibrato;

      const sig =
        (Math.sin(2 * Math.PI * instFreq * t) * 0.7 +
          Math.sin(2 * Math.PI * instFreq * 2 * t) * 0.2 +
          Math.sin(2 * Math.PI * instFreq * 3 * t) * 0.08) *
        attack *
        release *
        0.52;

      leadL[startSample + i] += sig * 0.95;
      leadR[startSample + i] += sig * 1.05;
    }
  }

  // 2. Background (Harmonic backing choir / chords: Am7 - Fmaj7 - Cmaj7 - G6)
  const bgBuffer = ctx.createBuffer(2, length, sampleRate);
  const bgL = bgBuffer.getChannelData(0);
  const bgR = bgBuffer.getChannelData(1);
  const chords = [
    [220.0, 261.63, 329.63, 392.0], // Am7
    [174.61, 220.0, 261.63, 329.63], // Fmaj7
    [261.63, 329.63, 392.0, 493.88], // Cmaj7
    [196.0, 246.94, 293.66, 329.63], // G6
  ];

  for (let bar = 0; bar < bars; bar++) {
    const chord = chords[bar % chords.length];
    const barStart = bar * 4 * beatDuration;
    const barDur = 4 * beatDuration;
    const startSample = Math.floor(barStart * sampleRate);
    const barSamples = Math.floor(barDur * sampleRate);

    for (let i = 0; i < barSamples && startSample + i < length; i++) {
      const t = i / sampleRate;
      const attack = Math.min(1, t / 0.08);
      const decay = Math.exp(-t * 0.95);
      const chorusL = 0.85 + 0.15 * Math.sin(2 * Math.PI * 3.8 * t);
      const chorusR = 0.85 + 0.15 * Math.cos(2 * Math.PI * 3.8 * t);

      let sum = 0;
      for (let n = 0; n < chord.length; n++) {
        const f = chord[n];
        sum += Math.sin(2 * Math.PI * f * t) + 0.15 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 3);
      }
      const val = (sum / chord.length) * attack * decay * 0.48;
      bgL[startSample + i] += val * chorusL;
      bgR[startSample + i] += val * chorusR;
    }
  }

  // 3. Drums Stem (Kick, Snare, Hi-Hat groove)
  const drumsBuffer = ctx.createBuffer(2, length, sampleRate);
  const drumsL = drumsBuffer.getChannelData(0);
  const drumsR = drumsBuffer.getChannelData(1);

  for (let beat = 0; beat < totalBeats * 2; beat++) {
    const time = beat * (beatDuration / 2);
    const startSample = Math.floor(time * sampleRate);

    const stepInBar = beat % 8;
    if (stepInBar === 0 || stepInBar === 3 || stepInBar === 4) {
      const kickLen = Math.floor(0.28 * sampleRate);
      for (let i = 0; i < kickLen && startSample + i < length; i++) {
        const t = i / sampleRate;
        const freq = 125 * Math.exp(-t * 28) + 46;
        const env = Math.exp(-t * 11);
        const val = Math.sin(2 * Math.PI * freq * t) * env * 0.75;
        drumsL[startSample + i] += val;
        drumsR[startSample + i] += val;
      }
    }

    if (stepInBar === 2 || stepInBar === 6) {
      const snareLen = Math.floor(0.22 * sampleRate);
      for (let i = 0; i < snareLen && startSample + i < length; i++) {
        const t = i / sampleRate;
        const noise = (Math.random() * 2 - 1) * Math.exp(-t * 18);
        const body = Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 24);
        const val = (noise * 0.45 + body * 0.35) * 0.7;
        drumsL[startSample + i] += val;
        drumsR[startSample + i] += val;
      }
    }

    const hatLen = Math.floor(0.06 * sampleRate);
    const accent = stepInBar % 2 === 0 ? 0.25 : 0.16;
    for (let i = 0; i < hatLen && startSample + i < length; i++) {
      const t = i / sampleRate;
      const highNoise = (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 6200 * t) * Math.exp(-t * 55);
      drumsL[startSample + i] += highNoise * accent * 0.9;
      drumsR[startSample + i] += highNoise * accent * 1.1;
    }
  }

  // 4. Bass Stem (Warm sub + harmonic bassline)
  const bassBuffer = ctx.createBuffer(2, length, sampleRate);
  const bassL = bassBuffer.getChannelData(0);
  const bassR = bassBuffer.getChannelData(1);
  const bassNotes = [55.0, 43.65, 65.41, 49.0];

  for (let bar = 0; bar < bars; bar++) {
    const rootFreq = bassNotes[bar % bassNotes.length];
    for (let eighth = 0; eighth < 8; eighth++) {
      const noteStart = (bar * 4 + eighth * 0.5) * beatDuration;
      const noteDur = beatDuration * 0.45;
      const startSample = Math.floor(noteStart * sampleRate);
      const noteSamples = Math.floor(noteDur * sampleRate);
      const freq = eighth === 7 ? rootFreq * 1.5 : rootFreq;

      for (let i = 0; i < noteSamples && startSample + i < length; i++) {
        const t = i / sampleRate;
        const attack = Math.min(1, t / 0.012);
        const decay = Math.exp(-t * 3.5);
        const env = attack * decay;
        const sig =
          (Math.sin(2 * Math.PI * freq * t) * 0.65 +
            Math.sin(2 * Math.PI * freq * 2 * t) * 0.25 +
            Math.sin(2 * Math.PI * freq * 3 * t) * 0.1) *
          env *
          0.65;
        bassL[startSample + i] += sig;
        bassR[startSample + i] += sig;
      }
    }
  }

  const rawDemoStems = [
    { rawName: 'moises_stem_01_vox_main', fileName: 'moises_stem_01_vox_main.wav', buffer: leadBuffer },
    { rawName: 'moises_stem_02_bgv_harmonies', fileName: 'moises_stem_02_bgv_harmonies.wav', buffer: bgBuffer },
    { rawName: 'moises_stem_03_drumkit', fileName: 'moises_stem_03_drumkit.wav', buffer: drumsBuffer },
    { rawName: 'moises_stem_04_bassline', fileName: 'moises_stem_04_bassline.wav', buffer: bassBuffer },
  ];

  return rawDemoStems.map((item, idx) => ({
    id: `demo-${Date.now()}-${idx}`,
    name: item.rawName,
    rawName: item.rawName,
    fileName: item.fileName,
    buffer: item.buffer,
    peaks: computePeaks(item.buffer, 480),
    volume: 1.0,
    muted: false,
    soloed: false,
    color: STEM_COLORS[(existingCount + idx) % STEM_COLORS.length],
    duration: item.buffer.duration,
    sampleRate: item.buffer.sampleRate,
    numberOfChannels: item.buffer.numberOfChannels,
    isClassifying: true,
    acousticProfile: computeAcousticProfile(item.buffer),
  }));
}
