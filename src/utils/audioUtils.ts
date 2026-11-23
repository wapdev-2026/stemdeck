import JSZip from 'jszip';
import {
  AcousticProfile,
  ExportSummary,
  ImportError,
  Stem,
  StemCategory,
  StemClassification,
} from '../types/stem';

export const SUPPORTED_AUDIO_EXTENSIONS = [
  'mp3',
  'wav',
  'm4a',
  'aac',
  'flac',
  'ogg',
  'aiff',
  'aif',
  'caf',
  'webm',
  'mp4',
  'm4r',
  '3gp',
];

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

export const ALL_STEM_CATEGORIES: StemCategory[] = [
  'Vocals',
  'Background',
  'Drums',
  'Bass',
  'Guitar',
  'Keys',
  'Synth',
  'Other',
];

export const VOLUME_PRESETS = [0, 10, 15, 25, 50, 75, 100, 125, 150];

export function getExtension(filename: string): string {
  const parts = (filename || '').toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

export function isSupportedAudioFile(filename: string, mimeType = ''): boolean {
  const ext = getExtension(filename);
  if (SUPPORTED_AUDIO_EXTENSIONS.includes(ext)) return true;
  if (mimeType && mimeType.toLowerCase().includes('audio')) return true;
  if (!mimeType || mimeType === 'application/octet-stream') {
    // On iOS Safari, files from iCloud/Files often have empty or octet-stream MIME types
    return true;
  }
  return false;
}

export function stripExtension(filepath: string): string {
  const normalized = (filepath || '').replace(/\\/g, '/');
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
  return false; // Accept all non-hidden files inside zip archives
}

/**
 * Robust iOS Safari / Android Chrome audio unlock helper.
 */
export async function unlockMobileAudioContext(ctx: AudioContext): Promise<void> {
  try {
    const nav = navigator as Navigator & {
      audioSession?: { type: string };
    };
    if (nav.audioSession && nav.audioSession.type !== 'playback') {
      nav.audioSession.type = 'playback';
    }
  } catch {
    // Ignore
  }

  try {
    const state = ctx.state as string;
    if (state === 'suspended' || state === 'interrupted') {
      await ctx.resume();
    }
  } catch {
    // Ignore
  }

  try {
    const silentBuffer = ctx.createBuffer(1, 1, ctx.sampleRate || 44100);
    const source = ctx.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch {
    // Ignore
  }
}

/**
 * Robust file arrayBuffer reader with fallback for older iOS Safari versions.
 */
export async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    try {
      const buf = await file.arrayBuffer();
      return buf;
    } catch {
      // Fall through to FileReader
    }
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result;
      if (res instanceof ArrayBuffer) {
        resolve(res);
      } else if (res && typeof res === 'object' && 'byteLength' in res) {
        resolve(res as unknown as ArrayBuffer);
      } else {
        reject(new Error('Failed to read file as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Cross-browser wrapper around AudioContext.decodeAudioData supporting both modern Promise
 * and legacy WebKit callback signatures on older iOS versions.
 */
export function decodeAudioBufferSafely(
  ctx: AudioContext,
  arrayBuffer: ArrayBuffer
): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    try {
      const copy = arrayBuffer.slice(0);
      const promise = ctx.decodeAudioData(
        copy,
        (decoded) => resolve(decoded),
        (err) => reject(err || new Error('Failed to decode audio data'))
      );
      if (promise && typeof promise.catch === 'function') {
        promise.catch((err) => reject(err));
      }
    } catch (err) {
      reject(err);
    }
  });
}

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

export function computeAcousticProfile(buffer: AudioBuffer): AcousticProfile {
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : null;
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
      spectralCentroidHz: 1000,
      stereoWidthRatio: 0,
      activeRatio: 0,
    };
  }

  const stride = Math.max(1, Math.floor(len / 48000));
  let sumSq = 0;
  let peak = 0;
  let zeroCrossings = 0;
  let count = 0;
  let activeSamples = 0;
  let midEnergySum = 0;
  let sideEnergySum = 0;

  let lowState = 0;
  let midLowState = 0;
  const effectiveSr = sr / stride;
  const alphaLow = Math.min(0.9, (2 * Math.PI * 250) / Math.max(1000, effectiveSr));
  const alphaMid = Math.min(0.95, (2 * Math.PI * 2500) / Math.max(1000, effectiveSr));

  let lowEnergy = 0;
  let midEnergy = 0;
  let highEnergy = 0;
  let prevSample = 0;

  for (let i = 0; i < len; i += stride) {
    const l = ch0[i];
    const r = ch1 ? ch1[i] : l;
    const s = 0.5 * (l + r);
    const side = 0.5 * (l - r);

    const abs = Math.max(Math.abs(l), Math.abs(r));
    if (abs > peak) peak = abs;
    if (abs > 0.015) activeSamples++;

    sumSq += s * s;
    midEnergySum += s * s;
    sideEnergySum += side * side;

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
  const lowRatio = lowEnergy / totalBandEnergy;
  const midRatio = midEnergy / totalBandEnergy;
  const highRatio = highEnergy / totalBandEnergy;

  const spectralCentroidHz = Math.round(
    lowRatio * 140 + midRatio * 1150 + highRatio * 4800
  );
  const stereoWidthRatio =
    midEnergySum + sideEnergySum > 1e-9
      ? Math.min(1, sideEnergySum / (midEnergySum + sideEnergySum))
      : 0;
  const activeRatio = count > 0 ? activeSamples / count : 0;

  return {
    rmsDb,
    peakDb,
    crestFactorDb,
    zeroCrossingRate,
    lowEnergyRatio: lowRatio,
    midEnergyRatio: midRatio,
    highEnergyRatio: highRatio,
    spectralCentroidHz,
    stereoWidthRatio,
    activeRatio,
  };
}

export function classifyStemLocally(
  id: string,
  rawName: string,
  fileName: string,
  ap: AcousticProfile
): StemClassification {
  const combined = `${rawName} ${fileName}`.toLowerCase();

  if (
    /\b(metronome|click|clicktrack|click[\s_-]?track|count[\s_-]?in|ticks?|beep)\b/i.test(
      combined
    ) ||
    combined.includes('metronome') ||
    combined.includes('click')
  ) {
    return {
      id,
      category: 'Other',
      displayName: 'Metronome',
      characterNote: 'Tempo click reference track',
      source: 'filename',
    };
  }

  if (
    /\b(bgv|bv|b\.?vocals?|background|backing|harmon(y|ies)|choir|coros?|back\s*vox|ad\s*libs?|second\s*vocal|double\s*vox)\b/i.test(
      combined
    ) ||
    combined.includes('background') ||
    combined.includes('backing') ||
    combined.includes('bgv') ||
    combined.includes('coro') ||
    combined.includes('harmon')
  ) {
    return {
      id,
      category: 'Background',
      displayName: 'Background Vocals',
      characterNote: 'Harmonic backing vocal layer',
      source: 'filename',
    };
  }

  if (
    /\b(lead\s*vocals?|main\s*vocals?|vocals?|vox|voice|voz|voces|singer|chant|gesang|acappella|acapella)\b/i.test(
      combined
    ) ||
    combined.includes('vocal') ||
    combined.includes('vox') ||
    combined.includes('voz')
  ) {
    return {
      id,
      category: 'Vocals',
      displayName: combined.includes('lead') ? 'Lead Vocals' : 'Vocals',
      characterNote: 'Lead vocal melody track',
      source: 'filename',
    };
  }

  if (
    /\b(drums?|drumkit|kit|percussion|perc|bateria|batería|kick|snare|hi[\s-]?hat|cymbals?|toms?|beat|claps?|shaker|congas?|bongos?)\b/i.test(
      combined
    ) ||
    combined.includes('drum') ||
    combined.includes('perc') ||
    combined.includes('bateria')
  ) {
    const isPerc =
      (combined.includes('perc') && !combined.includes('drum')) ||
      combined.includes('shaker') ||
      combined.includes('conga');
    return {
      id,
      category: 'Drums',
      displayName: isPerc ? 'Percussion' : 'Drums',
      characterNote: isPerc ? 'Rhythmic percussion groove' : 'Punchy drum kit groove',
      source: 'filename',
    };
  }

  if (
    /\b(bass|bassline|sub[\s-]?bass|808|bajo|baixo|basse|contrabass|upright\s*bass|synth\s*bass)\b/i.test(
      combined
    ) ||
    combined.includes('bass') ||
    combined.includes('bajo') ||
    combined.includes('baixo')
  ) {
    return {
      id,
      category: 'Bass',
      displayName: combined.includes('synth') ? 'Synth Bass' : 'Bass',
      characterNote: 'Warm low-end bassline',
      source: 'filename',
    };
  }

  if (
    /\b(guitars?|gtr|guitarra|ac[\s_-]?gtr|el[\s_-]?gtr|acoustic\s*guitar|electric\s*guitar|rhythm\s*guitar|lead\s*guitar|clean\s*guitar|distorted\s*guitar)\b/i.test(
      combined
    ) ||
    combined.includes('guitar') ||
    combined.includes('gtr')
  ) {
    let displayName = 'Guitar';
    if (combined.includes('acoustic')) displayName = 'Acoustic Guitar';
    else if (combined.includes('electric')) displayName = 'Electric Guitar';
    else if (combined.includes('lead')) displayName = 'Lead Guitar';
    else if (combined.includes('rhythm')) displayName = 'Rhythm Guitar';
    return {
      id,
      category: 'Guitar',
      displayName,
      characterNote: `${displayName} harmonic track`,
      source: 'filename',
    };
  }

  if (
    /\b(keys|keyboards?|piano|pno|organ|rhodes|wurli|wurlitzer|clav|clavinet|teclado|epiano|electric\s*piano)\b/i.test(
      combined
    ) ||
    combined.includes('piano') ||
    combined.includes('keys') ||
    combined.includes('organ') ||
    combined.includes('rhodes') ||
    combined.includes('teclado')
  ) {
    let displayName = 'Keys';
    if (combined.includes('piano')) displayName = 'Piano';
    else if (combined.includes('organ')) displayName = 'Organ';
    else if (combined.includes('rhodes')) displayName = 'Rhodes';
    return {
      id,
      category: 'Keys',
      displayName,
      characterNote: `${displayName} chordal accompaniment`,
      source: 'filename',
    };
  }

  if (
    /\b(synths?|synthesizer|pad|strings?|orchestra|brass|horns?|arp|arpeggio|lead\s*synth|pluck)\b/i.test(
      combined
    ) ||
    combined.includes('synth') ||
    combined.includes('string') ||
    combined.includes('pad') ||
    combined.includes('brass')
  ) {
    let displayName = 'Synth';
    if (combined.includes('string')) displayName = 'Strings';
    else if (combined.includes('pad')) displayName = 'Synth Pad';
    else if (combined.includes('brass') || combined.includes('horn')) displayName = 'Brass';
    return {
      id,
      category: 'Synth',
      displayName,
      characterNote: `${displayName} texture layer`,
      source: 'filename',
    };
  }

  if (ap.lowEnergyRatio > 0.62 && ap.zeroCrossingRate < 500) {
    return {
      id,
      category: 'Bass',
      displayName: 'Bass',
      characterNote: 'Deep low-frequency bass stem',
      source: 'heuristic',
    };
  }

  if (ap.crestFactorDb > 12.2 && (ap.highEnergyRatio > 0.16 || ap.zeroCrossingRate > 1200)) {
    return {
      id,
      category: 'Drums',
      displayName: 'Drums',
      characterNote: 'High-transient percussive stem',
      source: 'heuristic',
    };
  }

  if (ap.midEnergyRatio > 0.52 && ap.stereoWidthRatio > 0.32) {
    return {
      id,
      category: 'Background',
      displayName: 'Background Vocals',
      characterNote: 'Wide stereo mid-range harmony',
      source: 'heuristic',
    };
  }

  if (ap.midEnergyRatio > 0.5 && ap.crestFactorDb >= 7.5 && ap.crestFactorDb <= 13.5) {
    return {
      id,
      category: 'Vocals',
      displayName: 'Vocals',
      characterNote: 'Mid-focused melodic vocal stem',
      source: 'heuristic',
    };
  }

  if (ap.midEnergyRatio > 0.45 && ap.lowEnergyRatio > 0.25) {
    return {
      id,
      category: 'Keys',
      displayName: 'Keys',
      characterNote: 'Balanced harmonic instrument stem',
      source: 'heuristic',
    };
  }

  return {
    id,
    category: 'Other',
    displayName: rawName.trim() || 'Other',
    characterNote: 'Auxiliary instrument stem',
    source: 'heuristic',
  };
}

export function extractAudioSnippetBase64(buffer: AudioBuffer): string {
  const ch0 = buffer.getChannelData(0);
  const sr = buffer.sampleRate || 44100;
  const len = ch0.length;
  if (len === 0) return '';

  const windowSec = Math.min(1.6, buffer.duration);
  const windowSamples = Math.max(1, Math.floor(windowSec * sr));

  let bestStart = 0;
  let bestEnergy = -1;
  const steps = 8;
  for (let w = 0; w < steps; w++) {
    const start = Math.floor((w / steps) * Math.max(0, len - windowSamples));
    let energy = 0;
    const checkStride = Math.max(1, Math.floor(windowSamples / 450));
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
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
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

export async function classifyStemsWithAI(stems: Stem[]): Promise<StemClassification[]> {
  if (stems.length === 0) return [];

  const localFallback = stems.map((s) =>
    classifyStemLocally(s.id, s.rawName, s.fileName, s.acousticProfile)
  );

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return localFallback;
  }

  const buildPayload = (includeSnippets: boolean) => ({
    stems: stems.map((stem) => ({
      id: stem.id,
      fileName: stem.fileName,
      rawName: stem.rawName,
      duration: stem.duration,
      channels: stem.numberOfChannels,
      acousticProfile: stem.acousticProfile,
      audioSnippetBase64: includeSnippets ? extractAudioSnippetBase64(stem.buffer) : undefined,
    })),
  });

  const shouldIncludeSnippets = stems.length <= 6;

  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 16000);
    try {
      const includeSnippets = attempt === 0 && shouldIncludeSnippets;
      const response = await fetch('/api/classify-stems', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(includeSnippets)),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (Array.isArray(data.classifications) && data.classifications.length > 0) {
          return data.classifications;
        }
      }
    } catch {
      clearTimeout(timeoutId);
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 400));
      }
    }
  }

  return localFallback;
}

export interface RawAudioCandidate {
  fileName: string;
  stemName: string;
  getArrayBuffer: () => Promise<ArrayBuffer>;
}

/**
 * Extremely robust file and ZIP extractor designed specifically for iOS Safari (Files/iCloud)
 * and Android Chrome (Downloads/Drive). Accepts any audio extension or MIME type.
 */
export async function extractAudioCandidates(
  fileList: FileList | File[]
): Promise<{ candidates: RawAudioCandidate[]; errors: ImportError[] }> {
  const files = Array.from(fileList);
  const candidates: RawAudioCandidate[] = [];
  const errors: ImportError[] = [];

  for (const file of files) {
    const ext = getExtension(file.name);
    const mime = (file.type || '').toLowerCase();

    const isZip =
      ext === 'zip' ||
      mime.includes('zip') ||
      mime.includes('compressed') ||
      mime.includes('octet-stream');

    // On iOS Safari, ZIP files from iCloud Drive can sometimes have empty or octet-stream MIME types,
    // so we attempt to load them with JSZip first; if JSZip succeeds, it's a valid ZIP archive!
    let successfullyLoadedAsZip = false;

    if (isZip || ext === 'zip' || !ext) {
      try {
        const arrayBuf = await readFileAsArrayBuffer(file);
        const zip = await JSZip.loadAsync(arrayBuf);
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

        if (foundAudioInZip > 0) {
          successfullyLoadedAsZip = true;
        }
      } catch {
        // Not a zip archive; fall through to audio file check
      }
    }

    if (successfullyLoadedAsZip) {
      continue;
    }

    if (isSupportedAudioFile(file.name, file.type) || ext) {
      candidates.push({
        fileName: file.name,
        stemName: stripExtension(file.name),
        getArrayBuffer: () => readFileAsArrayBuffer(file),
      });
    } else {
      errors.push({
        id: `${Date.now()}-${Math.random()}`,
        fileName: file.name,
        message: `Could not load "${file.name}". Use MP3, WAV, M4A, AAC, FLAC, OGG, or a .zip archive.`,
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

export function buildMixdownFilename(stems: Stem[]): string {
  if (stems.length === 0) return 'mixdown.wav';

  const anySoloed = stems.some((s) => s.soloed);
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

  descriptors.sort((a, b) => {
    if (a.isModified !== b.isModified) {
      return a.isModified ? -1 : 1;
    }
    return a.index - b.index;
  });

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

export function canShareAudioFile(): boolean {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') {
      return false;
    }
    const testFile = new File([new Uint8Array(8)], 'test.wav', { type: 'audio/wav' });
    return navigator.canShare({ files: [testFile] });
  } catch {
    return false;
  }
}

export async function shareAudioBlob(blob: Blob, fileName: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      const file = new File([blob], fileName, { type: 'audio/wav' });
      if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: fileName,
          text: `StemDeck Mixdown: ${fileName}`,
        });
        return true;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return true;
    }
  }
  return false;
}

export function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 15000);
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

  const OfflineCtx =
    window.OfflineAudioContext ||
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext })
      .webkitOfflineAudioContext;

  const offlineCtx = new OfflineCtx(2, totalFrames, sampleRate);

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
      timestamp: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
      blob,
    },
  };
}

export function encodeAudioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  
  const left = buffer.getChannelData(0);
  const right = numChannels > 1 ? buffer.getChannelData(1) : left;

  const bytesPerSample = 2;
  const blockAlign = 2 * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const outBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(outBuffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const sampleL = Math.max(-1, Math.min(1, left[i]));
    const sampleR = Math.max(-1, Math.min(1, right[i]));

    view.setInt16(offset, sampleL < 0 ? sampleL * 0x8000 : sampleL * 0x7fff, true);
    offset += 2;
    view.setInt16(offset, sampleR < 0 ? sampleR * 0x8000 : sampleR * 0x7fff, true);
    offset += 2;
  }

  return outBuffer;
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

export function createDemoStems(ctx: AudioContext, existingCount = 0): Stem[] {
  const sampleRate = ctx.sampleRate || 44100;
  const bpm = 110;
  const beatsPerBar = 4;
  const bars = 4;
  const totalBeats = beatsPerBar * bars;
  const beatDuration = 60 / bpm;
  const duration = totalBeats * beatDuration;
  const length = Math.floor(duration * sampleRate);

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

  const bgBuffer = ctx.createBuffer(2, length, sampleRate);
  const bgL = bgBuffer.getChannelData(0);
  const bgR = bgBuffer.getChannelData(1);
  const chords = [
    [220.0, 261.63, 329.63, 392.0],
    [174.61, 220.0, 261.63, 329.63],
    [261.63, 329.63, 392.0, 493.88],
    [196.0, 246.94, 293.66, 329.63],
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
        sum +=
          Math.sin(2 * Math.PI * f * t) +
          0.15 * Math.sin(2 * Math.PI * f * 2 * t) * Math.exp(-t * 3);
      }
      const val = (sum / chord.length) * attack * decay * 0.48;
      bgL[startSample + i] += val * chorusL;
      bgR[startSample + i] += val * chorusR;
    }
  }

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
      const highNoise =
        (Math.random() * 2 - 1) * Math.sin(2 * Math.PI * 6200 * t) * Math.exp(-t * 55);
      drumsL[startSample + i] += highNoise * accent * 0.9;
      drumsR[startSample + i] += highNoise * accent * 1.1;
    }
  }

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
    {
      rawName: 'moises_stem_02_bgv_harmonies',
      fileName: 'moises_stem_02_bgv_harmonies.wav',
      buffer: bgBuffer,
    },
    { rawName: 'moises_stem_03_drumkit', fileName: 'moises_stem_03_drumkit.wav', buffer: drumsBuffer },
    { rawName: 'moises_stem_04_bassline', fileName: 'moises_stem_04_bassline.wav', buffer: bassBuffer },
  ];

  return rawDemoStems.map((item, idx) => {
    const id = `demo-${Date.now()}-${idx}`;
    const acousticProfile = computeAcousticProfile(item.buffer);
    const localMatch = classifyStemLocally(id, item.rawName, item.fileName, acousticProfile);

    return {
      id,
      name: localMatch.displayName,
      rawName: item.rawName,
      fileName: item.fileName,
      buffer: item.buffer,
      peaks: computePeaks(item.buffer, 480),
      volume: 1.0,
      muted: false,
      soloed: false,
      color: CATEGORY_COLORS[localMatch.category] || STEM_COLORS[(existingCount + idx) % STEM_COLORS.length],
      duration: item.buffer.duration,
      sampleRate: item.buffer.sampleRate,
      numberOfChannels: item.buffer.numberOfChannels,
      category: localMatch.category,
      characterNote: localMatch.characterNote,
      classificationSource: 'heuristic',
      isClassifying: true,
      acousticProfile,
    };
  });
}

const CATEGORY_ORDER: Record<StemCategory, number> = {
  Vocals: 1,
  Background: 2,
  Guitar: 3,
  Keys: 4,
  Synth: 5,
  Bass: 6,
  Drums: 7,
  Other: 8,
};

export function sortStems(stems: Stem[]): Stem[] {
  return [...stems].sort((a, b) => {
    const aIsMetronome =
      a.name.toLowerCase().includes('metronome') ||
      a.fileName.toLowerCase().includes('metronome') ||
      a.fileName.toLowerCase().includes('click');
    const bIsMetronome =
      b.name.toLowerCase().includes('metronome') ||
      b.fileName.toLowerCase().includes('metronome') ||
      b.fileName.toLowerCase().includes('click');
    if (aIsMetronome && !bIsMetronome) return 1;
    if (!aIsMetronome && bIsMetronome) return -1;

    const catA = a.category || 'Other';
    const catB = b.category || 'Other';
    const orderA = CATEGORY_ORDER[catA] ?? 9;
    const orderB = CATEGORY_ORDER[catB] ?? 9;
    if (orderA !== orderB) return orderA - orderB;

    const nameA = a.name.toLowerCase();
    const nameB = b.name.toLowerCase();
    if (catA === 'Guitar') {
      const aIsAc = nameA.includes('acoustic');
      const bIsAc = nameB.includes('acoustic');
      if (!aIsAc && bIsAc) return -1;
      if (aIsAc && !bIsAc) return 1;
    }

    return 0;
  });
}
