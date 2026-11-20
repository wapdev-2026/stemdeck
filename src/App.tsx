import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Download,
  FolderArchive,
  Loader2,
  Moon,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Share2,
  Sliders,
  Square,
  Sun,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { StemStrip } from './components/StemStrip';
import { ExportSummary, ImportError, Stem, StemCategory } from './types/stem';
import {
  buildMixdownFilename,
  canShareAudioFile,
  CATEGORY_COLORS,
  classifyStemLocally,
  classifyStemsWithAI,
  computeAcousticProfile,
  computePeaks,
  createDemoStems,
  decodeAudioBufferSafely,
  exportMixdownWav,
  extractAudioCandidates,
  formatTime,
  getEffectiveStemGain,
  isStemAudible,
  shareAudioBlob,
  STEM_COLORS,
  stripExtension,
  triggerBlobDownload,
  unlockMobileAudioContext,
  VOLUME_PRESETS,
} from './utils/audioUtils';

const VALID_CATEGORIES: StemCategory[] = [
  'Vocals',
  'Background',
  'Drums',
  'Bass',
  'Guitar',
  'Keys',
  'Synth',
  'Other',
];

const CATEGORY_DEFAULT_LABELS: Record<StemCategory, string> = {
  Vocals: 'Vocals',
  Background: 'Background Vocals',
  Drums: 'Drums',
  Bass: 'Bass',
  Guitar: 'Guitar',
  Keys: 'Keys',
  Synth: 'Synth',
  Other: 'Other',
};

function normalizeCategory(raw?: string): StemCategory {
  if (!raw) return 'Other';
  const match = VALID_CATEGORIES.find((c) => c.toLowerCase() === raw.trim().toLowerCase());
  if (match) return match;
  const lower = raw.toLowerCase();
  if (
    lower.includes('back') ||
    lower.includes('bgv') ||
    lower.includes('choir') ||
    lower.includes('harmon') ||
    lower.includes('coro')
  ) {
    return 'Background';
  }
  if (lower.includes('voc') || lower.includes('voice') || lower.includes('lead') || lower.includes('voz')) {
    return 'Vocals';
  }
  if (lower.includes('drum') || lower.includes('perc') || lower.includes('beat') || lower.includes('bateria')) {
    return 'Drums';
  }
  if (lower.includes('bass') || lower.includes('bajo') || lower.includes('baixo')) return 'Bass';
  if (lower.includes('guit') || lower.includes('gtr')) return 'Guitar';
  if (lower.includes('key') || lower.includes('pian') || lower.includes('organ') || lower.includes('rhodes')) {
    return 'Keys';
  }
  if (lower.includes('synth') || lower.includes('string') || lower.includes('pad') || lower.includes('brass')) {
    return 'Synth';
  }
  return 'Other';
}

export default function App() {
  const [stems, setStems] = useState<Stem[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [loadingStatus, setLoadingStatus] = useState<string>('');
  const [isClassifyingAll, setIsClassifyingAll] = useState(false);
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [preventClipping, setPreventClipping] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSummary, setExportSummary] = useState<ExportSummary | null>(null);
  const [activeTab, setActiveTab] = useState<'deck' | 'mixer' | 'tools'>('deck');
  const [supportsNativeShare, setSupportsNativeShare] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(() =>
    typeof document !== 'undefined' ? document.documentElement.classList.contains('dark') : true
  );

  // Web Audio API references
  const audioCtxRef = useRef<AudioContext | null>(null);
  const activeSourcesRef = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const activeGainsRef = useRef<Map<string, GainNode>>(new Map());
  const playbackStartCtxTimeRef = useRef<number>(0);
  const pauseOffsetRef = useRef<number>(0);
  const rafIdRef = useRef<number | null>(null);
  const isPlayingRef = useRef<boolean>(false);
  const stemsRef = useRef<Stem[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  stemsRef.current = stems;
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    setSupportsNativeShare(canShareAudioFile());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (isDark) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
  }, [isDark]);

  const totalDuration = useMemo(() => {
    if (stems.length === 0) return 0;
    return Math.max(...stems.map((s) => s.duration));
  }, [stems]);

  const anySoloed = useMemo(() => stems.some((s) => s.soloed), [stems]);
  const allMuted = useMemo(() => stems.length > 0 && stems.every((s) => s.muted), [stems]);
  const anyMuted = useMemo(() => stems.some((s) => s.muted), [stems]);

  const audibleStemCount = useMemo(() => {
    return stems.filter((s) => isStemAudible(s, anySoloed) && s.volume > 0).length;
  }, [stems, anySoloed]);

  const liveExportFileName = useMemo(() => buildMixdownFilename(stems), [stems]);

  const sessionTitle = useMemo(() => {
    if (stems.length === 0) return 'StemDeck';
    const firstArrow = stems[0].fileName.indexOf(' → ');
    if (firstArrow > 0) {
      return stripExtension(stems[0].fileName.slice(0, firstArrow));
    }
    if (stems[0].id.startsWith('demo-')) {
      return 'Demo Multitrack Session';
    }
    return `${stems.length} Stems Session`;
  }, [stems]);

  const getOrCreateAudioContext = useCallback((): AudioContext => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtxRef.current = new AudioCtx();
    }
    return audioCtxRef.current;
  }, []);

  // Unlock iOS / Android AudioContext on first user touch anywhere in the app
  useEffect(() => {
    const handleFirstTouch = () => {
      if (audioCtxRef.current) {
        void unlockMobileAudioContext(audioCtxRef.current);
      }
    };
    window.addEventListener('touchstart', handleFirstTouch, { passive: true, once: true });
    window.addEventListener('click', handleFirstTouch, { passive: true, once: true });
    return () => {
      window.removeEventListener('touchstart', handleFirstTouch);
      window.removeEventListener('click', handleFirstTouch);
    };
  }, []);

  const stopActiveNodes = useCallback(() => {
    activeSourcesRef.current.forEach((source) => {
      try {
        source.onended = null;
        source.stop();
      } catch {
        // Ignore
      }
      try {
        source.disconnect();
      } catch {
        // Ignore
      }
    });
    activeSourcesRef.current.clear();

    activeGainsRef.current.forEach((gain) => {
      try {
        gain.disconnect();
      } catch {
        // Ignore
      }
    });
    activeGainsRef.current.clear();

    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const stopPlayback = useCallback(() => {
    stopActiveNodes();
    pauseOffsetRef.current = 0;
    setCurrentTime(0);
    setIsPlaying(false);
    isPlayingRef.current = false;
  }, [stopActiveNodes]);

  /**
   * Runs resilient Gemini AI stem recognition (with automatic acoustic+lexical fallback)
   * on the provided stems and updates their display names, categories, notes, and colors.
   */
  const runAiClassification = useCallback(async (targetStems: Stem[]) => {
    if (targetStems.length === 0) return;

    const targetIds = new Set(targetStems.map((s) => s.id));
    setIsClassifyingAll(true);
    setStems((prev) =>
      prev.map((s) => (targetIds.has(s.id) ? { ...s, isClassifying: true } : s))
    );

    try {
      const classifications = await classifyStemsWithAI(targetStems);
      const byId = new Map(classifications.map((c) => [c.id, c]));

      setStems((prev) =>
        prev.map((stem) => {
          if (!targetIds.has(stem.id)) return stem;
          // Preserve manual overrides if the user already tapped a role pill while AI was in flight
          if (stem.classificationSource === 'manual') {
            return { ...stem, isClassifying: false };
          }
          const matched = byId.get(stem.id);
          if (!matched) {
            return { ...stem, isClassifying: false };
          }
          const category = normalizeCategory(matched.category);
          return {
            ...stem,
            name: matched.displayName?.trim() || stem.name,
            category,
            characterNote: matched.characterNote?.trim() || stem.characterNote,
            color: CATEGORY_COLORS[category] || stem.color,
            classificationSource: matched.source || 'ai',
            isClassifying: false,
          };
        })
      );
    } catch {
      // classifyStemsWithAI already falls back to local acoustic classification,
      // so we simply clear the loading spinner without showing intrusive errors
      setStems((prev) =>
        prev.map((s) => (targetIds.has(s.id) ? { ...s, isClassifying: false } : s))
      );
    } finally {
      setIsClassifyingAll(false);
    }
  }, []);

  /**
   * Starts sample-aligned playback of all loaded stems at `offsetSeconds`.
   */
  const startPlaybackAt = useCallback(
    async (offsetSeconds: number) => {
      const currentStems = stemsRef.current;
      if (currentStems.length === 0) return;

      const ctx = getOrCreateAudioContext();
      await unlockMobileAudioContext(ctx);

      stopActiveNodes();

      const maxDur = Math.max(...currentStems.map((s) => s.duration));
      const clampedOffset = offsetSeconds >= maxDur ? 0 : Math.max(0, offsetSeconds);
      const anyStemSoloed = currentStems.some((s) => s.soloed);

      pauseOffsetRef.current = clampedOffset;
      playbackStartCtxTimeRef.current = ctx.currentTime - clampedOffset;

      for (const stem of currentStems) {
        if (clampedOffset >= stem.buffer.duration) {
          continue;
        }

        const source = ctx.createBufferSource();
        source.buffer = stem.buffer;

        const gainNode = ctx.createGain();
        const initialGain = getEffectiveStemGain(stem, anyStemSoloed);
        gainNode.gain.setValueAtTime(initialGain, ctx.currentTime);

        source.connect(gainNode);
        gainNode.connect(ctx.destination);

        // Sample-aligned start call across all stems
        source.start(0, clampedOffset);

        activeSourcesRef.current.set(stem.id, source);
        activeGainsRef.current.set(stem.id, gainNode);
      }

      setIsPlaying(true);
      isPlayingRef.current = true;
      setCurrentTime(clampedOffset);

      const updatePlayhead = () => {
        if (!isPlayingRef.current || !audioCtxRef.current) return;

        // If iOS interrupts AudioContext (e.g. incoming phone call or Siri), pause cleanly
        const ctxState = audioCtxRef.current.state as string;
        if (ctxState === 'interrupted' || ctxState === 'suspended') {
          stopActiveNodes();
          setIsPlaying(false);
          isPlayingRef.current = false;
          return;
        }

        const elapsed = audioCtxRef.current.currentTime - playbackStartCtxTimeRef.current;
        const latestStems = stemsRef.current;
        const latestMaxDur =
          latestStems.length > 0 ? Math.max(...latestStems.map((s) => s.duration)) : 0;

        if (elapsed >= latestMaxDur) {
          stopActiveNodes();
          pauseOffsetRef.current = 0;
          setCurrentTime(0);
          setIsPlaying(false);
          isPlayingRef.current = false;
          return;
        }

        pauseOffsetRef.current = elapsed;
        setCurrentTime(elapsed);
        rafIdRef.current = requestAnimationFrame(updatePlayhead);
      };

      rafIdRef.current = requestAnimationFrame(updatePlayhead);
    },
    [getOrCreateAudioContext, stopActiveNodes]
  );

  const pausePlayback = useCallback(() => {
    if (!isPlayingRef.current) return;
    if (audioCtxRef.current) {
      const elapsed = audioCtxRef.current.currentTime - playbackStartCtxTimeRef.current;
      pauseOffsetRef.current = Math.max(0, elapsed);
      setCurrentTime(pauseOffsetRef.current);
    }
    stopActiveNodes();
    setIsPlaying(false);
    isPlayingRef.current = false;
  }, [stopActiveNodes]);

  const togglePlayPause = useCallback(() => {
    if (stemsRef.current.length === 0) return;
    if (isPlayingRef.current) {
      pausePlayback();
    } else {
      void startPlaybackAt(pauseOffsetRef.current);
    }
  }, [pausePlayback, startPlaybackAt]);

  const handleSeek = useCallback(
    (newTime: number) => {
      if (stemsRef.current.length === 0) return;
      const maxDur = Math.max(...stemsRef.current.map((s) => s.duration));
      const clamped = Math.max(0, Math.min(maxDur, newTime));
      pauseOffsetRef.current = clamped;
      setCurrentTime(clamped);

      if (isPlayingRef.current) {
        void startPlaybackAt(clamped);
      }
    },
    [startPlaybackAt]
  );

  // MediaSession API integration for iPhone Lock Screen / Control Center & Android Notification Shade
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      if (stems.length > 0) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: sessionTitle,
          artist: `StemDeck (${audibleStemCount}/${stems.length} Stems)`,
          album: 'StemDeck Multitrack Mixer',
        });
      }
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
      navigator.mediaSession.setActionHandler('play', () => {
        void startPlaybackAt(pauseOffsetRef.current);
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        pausePlayback();
      });
      navigator.mediaSession.setActionHandler('stop', () => {
        stopPlayback();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (typeof details.seekTime === 'number') {
          handleSeek(details.seekTime);
        }
      });
    } catch {
      // Ignore on browsers with partial MediaSession support
    }
  }, [
    stems.length,
    audibleStemCount,
    sessionTitle,
    isPlaying,
    startPlaybackAt,
    pausePlayback,
    stopPlayback,
    handleSeek,
  ]);

  /**
   * Live GainNode updates via setTargetAtTime whenever mute, solo, or volume state changes.
   */
  useEffect(() => {
    const ctx = audioCtxRef.current;
    if (!ctx || !isPlaying) return;

    const anyStemSoloed = stems.some((s) => s.soloed);
    const now = ctx.currentTime;
    const TIME_CONSTANT = 0.015;

    for (const stem of stems) {
      const gainNode = activeGainsRef.current.get(stem.id);
      if (gainNode) {
        const targetGain = getEffectiveStemGain(stem, anyStemSoloed);
        gainNode.gain.setTargetAtTime(targetGain, now, TIME_CONSTANT);
      }
    }
  }, [stems, isPlaying]);

  // Global Spacebar handler for transport play/pause
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space' && e.key !== ' ') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const active = document.activeElement as HTMLElement | null;
      const tag = active?.tagName;
      const isTextInput =
        tag === 'TEXTAREA' ||
        active?.isContentEditable ||
        (tag === 'INPUT' &&
          (active as HTMLInputElement).type !== 'range' &&
          (active as HTMLInputElement).type !== 'checkbox');

      if (isTextInput) return;

      e.preventDefault();
      togglePlayPause();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause]);

  useEffect(() => {
    return () => {
      stopActiveNodes();
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close();
      }
    };
  }, [stopActiveNodes]);

  /**
   * Imports audio files and/or .zip archives, decodes with decodeAudioBufferSafely,
   * applies instant acoustic+lexical stem recognition, and refines with Gemini AI.
   */
  const handleFilesAdded = useCallback(
    async (fileList: FileList | File[]) => {
      if (!fileList || fileList.length === 0) return;

      setIsLoadingFiles(true);
      setLoadingStatus('Inspecting files and archives...');
      setExportSummary(null);

      const wasPlaying = isPlayingRef.current;
      if (wasPlaying) {
        pausePlayback();
      }

      try {
        const { candidates, errors: extractionErrors } = await extractAudioCandidates(fileList);
        const newErrors: ImportError[] = [...extractionErrors];
        const decodedStems: Stem[] = [];
        const ctx = getOrCreateAudioContext();
        await unlockMobileAudioContext(ctx);
        const baseColorOffset = stemsRef.current.length;

        for (let i = 0; i < candidates.length; i++) {
          const candidate = candidates[i];
          setLoadingStatus(`Decoding ${candidate.stemName} (${i + 1} of ${candidates.length})...`);

          // Yield briefly to keep iOS Safari / Android Chrome UI responsive during multi-stem decoding
          await new Promise((r) => setTimeout(r, 0));

          try {
            const arrayBuffer = await candidate.getArrayBuffer();
            const audioBuffer = await decodeAudioBufferSafely(ctx, arrayBuffer);
            const peaks = computePeaks(audioBuffer, 480);
            const acousticProfile = computeAcousticProfile(audioBuffer);
            const stemId = `stem-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;

            // Instant local acoustic + filename classification (0ms latency, works offline)
            const initialMatch = classifyStemLocally(
              stemId,
              candidate.stemName,
              candidate.fileName,
              acousticProfile
            );

            decodedStems.push({
              id: stemId,
              name: initialMatch.displayName,
              rawName: candidate.stemName,
              fileName: candidate.fileName,
              buffer: audioBuffer,
              peaks,
              volume: 1.0,
              muted: false,
              soloed: false,
              color:
                CATEGORY_COLORS[initialMatch.category] ||
                STEM_COLORS[(baseColorOffset + decodedStems.length) % STEM_COLORS.length],
              duration: audioBuffer.duration,
              sampleRate: audioBuffer.sampleRate,
              numberOfChannels: audioBuffer.numberOfChannels,
              category: initialMatch.category,
              characterNote: initialMatch.characterNote,
              classificationSource: 'heuristic',
              isClassifying: true,
              acousticProfile,
            });
          } catch {
            newErrors.push({
              id: `${Date.now()}-${i}-${Math.random()}`,
              fileName: candidate.fileName,
              message: `Could not decode ${candidate.fileName}. Use MP3, WAV, M4A, AAC, FLAC or OGG.`,
            });
          }
        }

        if (newErrors.length > 0) {
          setErrors((prev) => [...newErrors, ...prev]);
        }

        if (decodedStems.length > 0) {
          setStems((prev) => [...prev, ...decodedStems]);
          void runAiClassification(decodedStems);
        }
      } finally {
        setIsLoadingFiles(false);
        setLoadingStatus('');
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    },
    [getOrCreateAudioContext, pausePlayback, runAiClassification]
  );

  const handleLoadDemoStems = useCallback(async () => {
    if (isPlayingRef.current) {
      pausePlayback();
    }
    setExportSummary(null);
    const ctx = getOrCreateAudioContext();
    await unlockMobileAudioContext(ctx);
    const demoStems = createDemoStems(ctx, stemsRef.current.length);
    setStems((prev) => [...prev, ...demoStems]);
    void runAiClassification(demoStems);
  }, [getOrCreateAudioContext, pausePlayback, runAiClassification]);

  const handleToggleMute = useCallback((id: string) => {
    setStems((prev) =>
      prev.map((stem) => (stem.id === id ? { ...stem, muted: !stem.muted } : stem))
    );
  }, []);

  const handleToggleSolo = useCallback((id: string) => {
    setStems((prev) =>
      prev.map((stem) => (stem.id === id ? { ...stem, soloed: !stem.soloed } : stem))
    );
  }, []);

  const handleMuteAll = useCallback(() => {
    setStems((prev) => prev.map((stem) => ({ ...stem, muted: true })));
  }, []);

  const handleUnmuteAll = useCallback(() => {
    setStems((prev) => prev.map((stem) => ({ ...stem, muted: false })));
  }, []);

  const handleVolumeChange = useCallback((id: string, volume: number) => {
    const clamped = Math.max(0, Math.min(1.5, volume));
    setStems((prev) =>
      prev.map((stem) => (stem.id === id ? { ...stem, volume: clamped } : stem))
    );
  }, []);

  const handleCategoryChange = useCallback((id: string, category: StemCategory) => {
    setStems((prev) =>
      prev.map((stem) =>
        stem.id === id
          ? {
              ...stem,
              category,
              name: CATEGORY_DEFAULT_LABELS[category] || category,
              color: CATEGORY_COLORS[category] || stem.color,
              classificationSource: 'manual',
              isClassifying: false,
            }
          : stem
      )
    );
  }, []);

  const handleSetAllVolumes = useCallback((percent: number) => {
    const clamped = Math.max(0, Math.min(1.5, percent / 100));
    setStems((prev) => prev.map((stem) => ({ ...stem, volume: clamped })));
  }, []);

  const handleRemoveStem = useCallback(
    (id: string) => {
      const activeSource = activeSourcesRef.current.get(id);
      if (activeSource) {
        try {
          activeSource.onended = null;
          activeSource.stop();
          activeSource.disconnect();
        } catch {
          // Ignore
        }
        activeSourcesRef.current.delete(id);
      }

      const activeGain = activeGainsRef.current.get(id);
      if (activeGain) {
        try {
          activeGain.disconnect();
        } catch {
          // Ignore
        }
        activeGainsRef.current.delete(id);
      }

      setStems((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (next.length === 0) {
          stopPlayback();
        }
        return next;
      });
    },
    [stopPlayback]
  );

  const handleResetMix = useCallback(() => {
    setStems((prev) =>
      prev.map((stem) => ({
        ...stem,
        volume: 1.0,
        muted: false,
        soloed: false,
      }))
    );
  }, []);

  const handleClearAllStems = useCallback(() => {
    stopPlayback();
    setStems([]);
    setExportSummary(null);
    setActiveTab('deck');
  }, [stopPlayback]);

  const handleExportMixdown = useCallback(async () => {
    if (stems.length === 0 || isExporting) return;
    setIsExporting(true);
    setExportSummary(null);

    try {
      const { blob, summary } = await exportMixdownWav(stems, preventClipping);
      setExportSummary(summary);
      triggerBlobDownload(blob, summary.fileName);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error during offline rendering.';
      setErrors((prev) => [
        {
          id: `export-err-${Date.now()}`,
          fileName: liveExportFileName,
          message: `Could not export mixdown: ${msg}. Ensure at least one stem is loaded and audible.`,
        },
        ...prev,
      ]);
    } finally {
      setIsExporting(false);
    }
  }, [stems, preventClipping, isExporting, liveExportFileName]);

  const handleNativeShareMixdown = useCallback(async () => {
    if (!exportSummary?.blob) return;
    await shareAudioBlob(exportSummary.blob, exportSummary.fileName);
  }, [exportSummary]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragOver) setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.currentTarget.contains(e.relatedTarget as Node)) return;
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      void handleFilesAdded(e.dataTransfer.files);
    }
  };

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="min-h-dvh flex flex-col bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100 transition-colors"
    >
      <OfflineIndicator />

      {/* Hidden multi-file picker optimized for iPhone (iOS Files / iCloud) & Android (Downloads / Drive) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="audio/*,application/zip,application/x-zip-compressed,multipart/x-zip,.zip,.mp3,.wav,.m4a,.aac,.flac,.ogg,.aiff,.aif,.caf,.webm,.mp4"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) {
            void handleFilesAdded(e.target.files);
          }
        }}
        className="sr-only"
        aria-label="Import audio stems or ZIP file"
      />

      {/* Full-window drag overlay */}
      {isDragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-6">
          <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-indigo-400 bg-white/95 p-8 text-center shadow-xl dark:bg-slate-900/95">
            <FolderArchive className="h-10 w-10 text-indigo-500" />
            <p className="text-lg font-semibold text-slate-900 dark:text-white">
              Drop audio stems or a .zip archive
            </p>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Supports MP3, WAV, M4A, AAC, FLAC, OGG, and ZIP files
            </p>
          </div>
        </div>
      )}

      {/* Top Bar Contract: 3 zones */}
      <header className="safe-top sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur-md dark:border-slate-800 dark:bg-slate-950/90">
        <div className="landscape-compact-header mx-auto flex max-w-5xl items-center justify-between gap-4 px-3.5 py-2 sm:px-6 sm:py-3">
          {/* Zone 1: Brand Title */}
          <a
            href="#top"
            className="text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 rounded"
          >
            StemDeck
          </a>

          {/* Zone 2: Concise workspace summary */}
          <nav
            aria-label="Mixer summary"
            className="hidden sm:flex items-center gap-4 text-xs font-medium text-slate-500 dark:text-slate-400"
          >
            <span className="whitespace-nowrap shrink-0">
              {stems.length} {stems.length === 1 ? 'Stem' : 'Stems'}
            </span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap shrink-0">{audibleStemCount} Audible</span>
            <span aria-hidden="true" className="hidden lg:inline">
              ·
            </span>
            <span className="hidden lg:inline whitespace-nowrap shrink-0">
              Spacebar to Play / Pause
            </span>
          </nav>

          {/* Zone 3: PWA Install, Theme & Add Stems */}
          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setIsDark((prev) => !prev)}
              aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-700 transition-colors hover:bg-slate-100 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoadingFiles}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-indigo-500 active:scale-95 disabled:opacity-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <Plus className="h-4 w-4" />
              <span>Add</span>
              <span className="hidden sm:inline">Stems</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main
        id="top"
        className="landscape-compact-main mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3.5 px-3.5 py-3.5 pb-28 sm:px-6 sm:py-5 sm:pb-32"
      >
        {/* Error Banner List */}
        {errors.length > 0 && (
          <section aria-label="Import and decode errors" className="flex flex-col gap-2">
            {errors.map((err) => (
              <div
                key={err.id}
                role="alert"
                className="flex items-start justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs sm:text-sm text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
              >
                <div className="flex items-start gap-2">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <p className="leading-snug">{err.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setErrors((prev) => prev.filter((item) => item.id !== err.id))}
                  aria-label="Dismiss error"
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500 dark:text-rose-400 dark:hover:bg-rose-900/50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ))}
          </section>
        )}

        {/* Loading status banner when unpacking ZIP or decoding audio */}
        {isLoadingFiles && (
          <div
            role="status"
            className="flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3.5 py-2.5 text-xs sm:text-sm font-medium text-indigo-900 dark:border-indigo-900/60 dark:bg-indigo-950/40 dark:text-indigo-200"
          >
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-indigo-600 dark:text-indigo-400" />
            <span>{loadingStatus || 'Decoding audio stems...'}</span>
          </div>
        )}

        {/* Export Mixdown Feedback Banner with Native Mobile Share / Save to Files */}
        {exportSummary && (
          <div
            role="status"
            className="flex flex-col gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/90 px-3.5 py-3 text-xs sm:text-sm text-emerald-950 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                <div className="space-y-0.5">
                  <p className="font-semibold break-all">
                    Exported <span className="font-mono">{exportSummary.fileName}</span> (16-bit Stereo PCM ·{' '}
                    {exportSummary.sampleRate} Hz · {formatTime(exportSummary.duration)})
                  </p>
                  {exportSummary.preventClippingApplied ? (
                    <p className="text-xs text-emerald-800 dark:text-emerald-300">
                      Peak level exceeded 0 dBFS ({exportSummary.originalPeak.toFixed(2)} linear peak).
                      Scaled the entire mix down to 0.98 (−{exportSummary.dbRemoved.toFixed(2)} dB
                      removed) to prevent clipping.
                    </p>
                  ) : exportSummary.clipped ? (
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Peak level reached {exportSummary.originalPeak.toFixed(2)} (exceeded 1.0) and was
                      hard-clamped because &ldquo;Prevent clipping&rdquo; was turned off.
                    </p>
                  ) : (
                    <p className="text-xs text-emerald-800 dark:text-emerald-300">
                      Peak level was {(exportSummary.originalPeak * 100).toFixed(1)}% of full scale (no
                      gain reduction needed).
                    </p>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setExportSummary(null)}
                aria-label="Dismiss export summary"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-emerald-700 hover:bg-emerald-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 dark:text-emerald-400 dark:hover:bg-emerald-900/50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {exportSummary.blob && (
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <button
                  type="button"
                  onClick={() =>
                    exportSummary.blob &&
                    triggerBlobDownload(exportSummary.blob, exportSummary.fileName)
                  }
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-2.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 active:scale-95 dark:border-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Download WAV Again</span>
                </button>

                {supportsNativeShare && (
                  <button
                    type="button"
                    onClick={() => void handleNativeShareMixdown()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 active:scale-95"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    <span>Share / Save to Files</span>
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Session Deck Header & View Mode Tabs (Inspired by the user's screenshot) */}
        {stems.length > 0 && (
          <section aria-label="Session header and view tabs" className="flex flex-col gap-3">
            {/* Top Row: [X Clear]  —  Session Title & Subtitle  —  [Export WAV Button] */}
            <div className="flex items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={handleClearAllStems}
                aria-label="Close session and clear all stems"
                title="Close session and clear all stems"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-rose-950/50 dark:hover:text-rose-400"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="min-w-0 flex-1 text-center">
                <h2 className="truncate text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-amber-400">
                  {sessionTitle}
                </h2>
                <p className="truncate text-[11px] font-medium text-slate-500 dark:text-amber-500/80">
                  {audibleStemCount} of {stems.length} stems audible · Tap icon to mute, speaker for %
                </p>
              </div>

              <button
                type="button"
                onClick={() => void handleExportMixdown()}
                disabled={isExporting || audibleStemCount === 0}
                aria-label="Export mixdown (WAV)"
                title={`Export mixdown as ${liveExportFileName}`}
                className="flex h-10 min-w-[40px] sm:px-3.5 shrink-0 items-center justify-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 text-amber-700 transition-colors hover:bg-amber-500/25 active:scale-95 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-300 dark:hover:bg-amber-400/25"
              >
                {isExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                <span className="hidden sm:inline text-xs font-semibold">Export WAV</span>
              </button>
            </div>

            {/* Mode Switcher Tabs: [Stems (Deck)]  [Faders (Mixer)]  [Presets & AI] */}
            <div
              role="tablist"
              aria-label="Mixer view mode"
              className="flex items-center justify-center gap-2 sm:gap-3"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'deck'}
                onClick={() => setActiveTab('deck')}
                className={`rounded-full px-4 py-1.5 text-xs sm:text-sm font-bold transition-all whitespace-nowrap shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  activeTab === 'deck'
                    ? 'bg-amber-400 text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 dark:text-amber-400/80 dark:hover:text-amber-300'
                }`}
              >
                Stems
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'mixer'}
                onClick={() => setActiveTab('mixer')}
                className={`rounded-full px-4 py-1.5 text-xs sm:text-sm font-bold transition-all whitespace-nowrap shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  activeTab === 'mixer'
                    ? 'bg-amber-400 text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 dark:text-amber-400/80 dark:hover:text-amber-300'
                }`}
              >
                Faders
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'tools'}
                onClick={() => setActiveTab('tools')}
                className={`rounded-full px-4 py-1.5 text-xs sm:text-sm font-bold transition-all whitespace-nowrap shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 ${
                  activeTab === 'tools'
                    ? 'bg-amber-400 text-slate-950 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900 dark:text-amber-400/80 dark:hover:text-amber-300'
                }`}
              >
                Presets & AI
              </button>
            </div>
          </section>
        )}

        {/* Tab Panel: Presets & AI (Mix Tools) */}
        {stems.length > 0 && activeTab === 'tools' && (
          <section
            aria-label="Global presets and AI tools"
            className="flex flex-col gap-3.5 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleMuteAll}
                  disabled={allMuted}
                  className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 active:scale-95 ${
                    allMuted
                      ? 'border-rose-600 bg-rose-600 text-white'
                      : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-rose-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  <VolumeX className="h-3.5 w-3.5" />
                  <span>Mute All</span>
                </button>

                <button
                  type="button"
                  onClick={handleUnmuteAll}
                  disabled={!anyMuted}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 active:scale-95 disabled:opacity-45 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>Unmute All</span>
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void runAiClassification(stems)}
                  disabled={isClassifyingAll}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-indigo-200 bg-indigo-50/80 px-3 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 active:scale-95 disabled:opacity-50 whitespace-nowrap shrink-0 dark:border-indigo-900/60 dark:bg-indigo-950/50 dark:text-indigo-300"
                >
                  {isClassifyingAll ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      <span>AI Identifying...</span>
                    </>
                  ) : (
                    <>
                      <Wand2 className="h-3.5 w-3.5" />
                      <span>Re-Analyze Stems with AI</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleResetMix}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100 active:scale-95 whitespace-nowrap shrink-0 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset Mix</span>
                </button>
              </div>
            </div>

            {/* All Volume Quick Percentage Buttons */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
                Set All Stems Volume %
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                {VOLUME_PRESETS.map((preset) => {
                  const allAtPreset =
                    stems.length > 0 && stems.every((s) => Math.round(s.volume * 100) === preset);
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => handleSetAllVolumes(preset)}
                      className={`min-h-[34px] rounded-xl px-3 py-1 font-mono text-xs font-medium transition-colors whitespace-nowrap shrink-0 active:scale-95 ${
                        allAtPreset
                          ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                      }`}
                    >
                      {preset}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Prevent Clipping & Intelligent Export Filename */}
            <div className="flex flex-col gap-2.5 rounded-xl bg-slate-50 p-3 text-xs dark:bg-slate-950/70">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="inline-flex cursor-pointer select-none items-center gap-2 font-medium text-slate-700 dark:text-slate-300">
                  <input
                    type="checkbox"
                    checked={preventClipping}
                    onChange={(e) => setPreventClipping(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800"
                  />
                  <span>Prevent clipping (auto-scale peaks &gt; 0 dBFS to 0.98)</span>
                </label>

                <button
                  type="button"
                  onClick={() => void handleExportMixdown()}
                  disabled={isExporting || audibleStemCount === 0}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>Export mixdown (WAV)</span>
                </button>
              </div>

              <div className="flex min-w-0 items-center gap-1.5 text-slate-500 dark:text-slate-400">
                <span className="shrink-0">Export file:</span>
                <code
                  className="truncate font-mono text-xs text-slate-800 dark:text-slate-200"
                  title={liveExportFileName}
                >
                  {liveExportFileName}
                </code>
              </div>
            </div>
          </section>
        )}

        {/* Stem Strips List or Empty Dropzone State */}
        {stems.length > 0 ? (
          <section aria-label="Loaded stems" className="flex flex-col gap-2.5">
            {stems.map((stem) => {
              const audible = isStemAudible(stem, anySoloed);
              return (
                <StemStrip
                  key={stem.id}
                  stem={stem}
                  isAudible={audible}
                  anySoloed={anySoloed}
                  totalDuration={totalDuration}
                  currentTime={currentTime}
                  isDark={isDark}
                  viewMode={activeTab === 'mixer' ? 'mixer' : 'deck'}
                  onToggleMute={handleToggleMute}
                  onToggleSolo={handleToggleSolo}
                  onVolumeChange={handleVolumeChange}
                  onCategoryChange={handleCategoryChange}
                  onRemove={handleRemoveStem}
                  onSeek={handleSeek}
                />
              );
            })}

            {/* Subtle Quick-Action Footer Pill Bar below Stems */}
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={allMuted ? handleUnmuteAll : handleMuteAll}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 active:scale-95 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {allMuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                  <span>{allMuted ? 'Unmute All' : 'Mute All'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab(activeTab === 'tools' ? 'deck' : 'tools')}
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 active:scale-95 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <Sliders className="h-3.5 w-3.5" />
                  <span>All % Presets</span>
                </button>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-dashed border-slate-300 px-3 text-xs font-medium text-slate-600 transition-colors hover:border-indigo-400 hover:text-indigo-600 active:scale-95 dark:border-slate-800 dark:text-slate-400 dark:hover:border-indigo-500"
              >
                <Upload className="h-3.5 w-3.5" />
                <span>Add more stems</span>
              </button>
            </div>
          </section>
        ) : (
          /* Empty State */
          <section
            aria-label="Import stems empty state"
            className="flex flex-1 flex-col items-center justify-center py-4 sm:py-8"
          >
            <div className="flex w-full max-w-2xl flex-col items-center rounded-2xl border-2 border-dashed border-slate-300 bg-white p-6 text-center sm:p-12 dark:border-slate-800 dark:bg-slate-900/70">
              <div className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 dark:bg-indigo-950/70 dark:text-indigo-400">
                <FolderArchive className="h-6 w-6 sm:h-7 sm:w-7" />
              </div>

              <h1
                className="mt-4 sm:mt-5 text-xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white"
                style={{ textWrap: 'balance' }}
              >
                Drop audio stems or a ZIP file to start mixing
              </h1>

              <p className="mt-2 max-w-lg text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                Select or drop multiple audio files or a{' '}
                <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-800 dark:bg-slate-800 dark:text-slate-200">
                  .zip
                </code>{' '}
                archive to load your tracks, play them in sync, and export a WAV mixdown.
              </p>

              <div className="mt-6 flex w-full sm:w-auto flex-col sm:flex-row items-stretch sm:items-center justify-center gap-2.5 sm:gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoadingFiles}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-indigo-500 active:scale-98 disabled:opacity-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <Upload className="h-4 w-4" />
                  <span>Select Audio Files or .ZIP</span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleLoadDemoStems()}
                  disabled={isLoadingFiles}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 active:scale-98 disabled:opacity-50 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                >
                  <Music className="h-4 w-4" />
                  <span>Load 4 Demo Stems</span>
                </button>
              </div>

              <div className="mt-6 sm:mt-8 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <span>MP3, WAV, M4A, AAC, FLAC, OGG, ZIP</span>
                <span aria-hidden="true">·</span>
                <span>AI Stem Recognition</span>
                <span aria-hidden="true">·</span>
                <span>iPhone &amp; Android Ready</span>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* Bottom Transport Scrubber Bar (Anchored in the natural thumb zone with iPhone Home Indicator safe-area) */}
      {stems.length > 0 && (
        <footer
          aria-label="Playback transport bar"
          className="safe-bottom-bar fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200/80 bg-white/95 px-4 pt-2.5 backdrop-blur-md dark:border-slate-800/80 dark:bg-slate-950/95"
        >
          <div className="mx-auto flex max-w-4xl items-center gap-3">
            {/* Play / Pause Button */}
            <button
              type="button"
              onClick={togglePlayPause}
              aria-label={isPlaying ? 'Pause' : 'Play'}
              title={isPlaying ? 'Pause (Spacebar)' : 'Play (Spacebar)'}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-slate-950 shadow-sm transition-transform hover:bg-amber-300 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              {isPlaying ? (
                <Pause className="h-4 w-4 fill-current" />
              ) : (
                <Play className="h-4 w-4 translate-x-0.5 fill-current" />
              )}
            </button>

            {/* Stop Button */}
            <button
              type="button"
              onClick={stopPlayback}
              aria-label="Stop"
              title="Stop and return to start"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-slate-700 transition-colors hover:bg-slate-200 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <Square className="h-3.5 w-3.5 fill-current" />
            </button>

            {/* Warm Gold / Orange Master Scrubber Bar */}
            <div className="flex flex-1 items-center gap-2.5">
              <span className="w-11 shrink-0 text-right font-mono text-xs font-medium text-slate-700 dark:text-amber-400">
                {formatTime(currentTime)}
              </span>

              <input
                type="range"
                min={0}
                max={totalDuration || 1}
                step={0.01}
                value={Math.min(currentTime, totalDuration || 0)}
                aria-label="Master timeline seek bar"
                onChange={(e) => handleSeek(Number(e.target.value))}
                className="stem-slider h-7 w-full rounded-full bg-slate-200 text-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 dark:bg-amber-950/70 dark:text-amber-400"
              />

              <span className="w-10 shrink-0 font-mono text-xs text-slate-500 dark:text-amber-500/80">
                {formatTime(totalDuration)}
              </span>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
