import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Clock,
  Download,
  FolderArchive,
  Layers,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Share2,
  Sliders,
   Trash2,
  Upload,
  Volume2,
  VolumeX,
  Wand2,
  X,
} from 'lucide-react';
import { OfflineIndicator, PWAInstallButton } from './components/PWAInstallButton';
import { StemStrip } from './components/StemStrip';
import { WaveformCanvas } from './components/WaveformCanvas';
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
  sortStems,
} from './utils/audioUtils';
import { deleteSavedSession, getSavedSessions, SavedSession, saveSessionToDb } from './utils/db';

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
  const [preventClipping] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportSummary, setExportSummary] = useState<ExportSummary | null>(null);
  const [supportsNativeShare, setSupportsNativeShare] = useState(false);
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>([]);
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [activeBandRole, setActiveBandRole] = useState<string | null>(null);
  const [showBandRoleModal, setShowBandRoleModal] = useState<boolean>(false);

  const handleSelectBandRole = useCallback((role: string) => {
    setActiveBandRole(role);
    setShowBandRoleModal(false);
    setStems((prev) =>
      prev.map((stem) => {
        const stemCat = stem.category || 'Other';
        const nameLower = `${stem.name} ${stem.fileName}`.toLowerCase();
        let matches = false;
        if (role === 'Electric Guitar') {
          matches = stemCat === 'Guitar' && !nameLower.includes('acoustic');
        } else if (role === 'Acoustic Guitar') {
          matches = stemCat === 'Guitar' && nameLower.includes('acoustic');
        } else if (role === 'Lead Vocals') {
          matches = stemCat === 'Vocals';
        } else if (role === 'Background Vocals') {
          matches = stemCat === 'Background';
        } else if (role === 'Piano / Keys') {
          matches = stemCat === 'Keys' || stemCat === 'Synth';
        } else if (role === 'Bass') {
          matches = stemCat === 'Bass';
        } else if (role === 'Drums') {
          matches = stemCat === 'Drums';
        }

        return {
          ...stem,
          volume: matches ? 1.0 : 0.15,
          muted: false,
        };
      })
    );
  }, []);

  const handleClearBandRole = useCallback(() => {
    setActiveBandRole(null);
    setStems((prev) => prev.map((s) => ({ ...s, volume: 1.0 })));
  }, []);

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
    document.documentElement.classList.add('dark');
    void loadSavedSessionsList();
  }, []);

  const loadSavedSessionsList = async () => {
    try {
      const list = await getSavedSessions();
      setSavedSessions(list);
    } catch {
      // Ignore
    }
  };

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

  const [sessionTitle, setSessionTitle] = useState<string>('Stem_Session');

  const sortedStems = useMemo(() => {
    return sortStems(stems);
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
          if (stem.classificationSource === 'manual') {
            return { ...stem, isClassifying: false };
          }
          const localCheck = classifyStemLocally(stem.id, stem.rawName, stem.fileName, stem.acousticProfile);
          if (localCheck.source === 'filename') {
            const category = normalizeCategory(localCheck.category);
            return {
              ...stem,
              name: localCheck.displayName,
              category,
              characterNote: localCheck.characterNote,
              color: CATEGORY_COLORS[category] || stem.color,
              classificationSource: 'filename',
              isClassifying: false,
            };
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
      setStems((prev) =>
        prev.map((s) => (targetIds.has(s.id) ? { ...s, isClassifying: false } : s))
      );
    } finally {
      setIsClassifyingAll(false);
    }
  }, []);

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

        source.start(0, clampedOffset);

        activeSourcesRef.current.set(stem.id, source);
        activeGainsRef.current.set(stem.id, gainNode);
      }

      setIsPlaying(true);
      isPlayingRef.current = true;
      setCurrentTime(clampedOffset);

      const updatePlayhead = () => {
        if (!isPlayingRef.current || !audioCtxRef.current) return;

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

  const handleSkipSeconds = useCallback(
    (delta: number) => {
      if (stemsRef.current.length === 0) return;
      const maxDur = Math.max(...stemsRef.current.map((s) => s.duration));
      const nextTime = Math.max(0, Math.min(maxDur, currentTime + delta));
      handleSeek(nextTime);
    },
    [currentTime, handleSeek]
  );

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

  const handleFilesAdded = useCallback(
    async (fileList: FileList | File[]) => {
      if (!fileList || fileList.length === 0) return;

      const files = Array.from(fileList);
      const zipFiles = files.filter((f) => {
        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        const mime = (f.type || '').toLowerCase();
        return ext === 'zip' || mime.includes('zip') || mime.includes('compressed') || mime.includes('octet-stream');
      });

      if (zipFiles.length > 1) {
        setErrors((prev) => [
          {
            id: `multi-zip-${Date.now()}`,
            fileName: 'Multiple ZIP files',
            message: 'Please upload only one ZIP file at a time. Uploading multiple ZIPs simultaneously is too heavy and causes memory issues.',
          },
          ...prev,
        ]);
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      const firstFile = files[0];
      if (firstFile) {
        const inferred = stripExtension(firstFile.name).replace(/\s+/g, '_');
        if (inferred) setSessionTitle(inferred);
      }

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
          await new Promise((r) => setTimeout(r, 0));

          try {
            const arrayBuffer = await candidate.getArrayBuffer();
            const audioBuffer = await decodeAudioBufferSafely(ctx, arrayBuffer);
            const peaks = computePeaks(audioBuffer, 480);
            const acousticProfile = computeAcousticProfile(audioBuffer);
            const stemId = `stem-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7)}`;

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
          setStems((prev) => {
            const next = [...prev, ...decodedStems];
            void saveSessionToDb(sessionTitle, next);
            void loadSavedSessionsList();
            return next;
          });
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
    [getOrCreateAudioContext, pausePlayback, runAiClassification, sessionTitle]
  );

  const handleLoadDemoStems = useCallback(async () => {
    if (isPlayingRef.current) {
      pausePlayback();
    }
    setExportSummary(null);
    const ctx = getOrCreateAudioContext();
    await unlockMobileAudioContext(ctx);
    const demoStems = createDemoStems(ctx, stemsRef.current.length);
    setSessionTitle('Demo_Session');
    setStems((prev) => {
      const next = [...prev, ...demoStems];
      void saveSessionToDb('Demo_Session', next);
      void loadSavedSessionsList();
      return next;
    });
    void runAiClassification(demoStems);
  }, [getOrCreateAudioContext, pausePlayback, runAiClassification]);

  const handleLoadSavedSession = useCallback(
    async (savedSession: SavedSession) => {
      if (isPlayingRef.current) {
        pausePlayback();
      }
      setIsLoadingFiles(true);
      setLoadingStatus(`Loading "${savedSession.title}" from storage...`);
      setExportSummary(null);

      try {
        const ctx = getOrCreateAudioContext();
        await unlockMobileAudioContext(ctx);
        setSessionTitle(savedSession.title || 'Saved_Session');
        const restoredStems: Stem[] = [];

        for (let i = 0; i < savedSession.stems.length; i++) {
          const s = savedSession.stems[i];
          const audioBuffer = await decodeAudioBufferSafely(ctx, s.arrayBuffer);
          const peaks = computePeaks(audioBuffer, 480);
          const acousticProfile = computeAcousticProfile(audioBuffer);
          const stemId = `restored-${Date.now()}-${i}`;
          const category = s.category || 'Other';

          restoredStems.push({
            id: stemId,
            name: s.name,
            rawName: s.rawName,
            fileName: s.fileName,
            buffer: audioBuffer,
            peaks,
            volume: 1.0,
            muted: false,
            soloed: false,
            color: s.color || CATEGORY_COLORS[category] || STEM_COLORS[i % STEM_COLORS.length],
            duration: audioBuffer.duration,
            sampleRate: audioBuffer.sampleRate,
            numberOfChannels: audioBuffer.numberOfChannels,
            category,
            characterNote: s.characterNote,
            classificationSource: 'manual',
            isClassifying: false,
            acousticProfile,
          });
        }

        setStems(restoredStems);
        setShowSessionsModal(false);
      } catch (err) {
        setErrors((prev) => [
          {
            id: `restore-err-${Date.now()}`,
            fileName: savedSession.title,
            message: `Could not load saved session: ${err instanceof Error ? err.message : 'Unknown error'}`,
          },
          ...prev,
        ]);
      } finally {
        setIsLoadingFiles(false);
        setLoadingStatus('');
      }
    },
    [getOrCreateAudioContext, pausePlayback]
  );

  const handleDeleteSavedSession = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteSavedSession(id);
      await loadSavedSessionsList();
    } catch {
      // Ignore
    }
  }, []);

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

  const handleClearAllStems = useCallback(() => {
    stopPlayback();
    setStems([]);
    setActiveBandRole(null);
    setSessionTitle('Stem_Session');
    setExportSummary(null);
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
          message: `Could not export mixdown: ${msg}.`,
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
      className="min-h-dvh flex flex-col bg-[#07040f] text-slate-100 select-none overflow-x-hidden"
    >
      <OfflineIndicator />

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

      {isDragOver && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[#07040f]/90 backdrop-blur-xs p-6">
          <div className="flex max-w-md flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-[#7c3aed] bg-[#0d071a] p-8 text-center shadow-2xl">
            <FolderArchive className="h-10 w-10 text-[#22d3ee]" />
            <p className="text-lg font-semibold text-white">Drop audio stems or a .zip archive</p>
            <p className="text-sm text-slate-400">Supports MP3, WAV, M4A, FLAC, OGG, and ZIP files</p>
          </div>
        </div>
      )}

      {/* Saved Sessions Modal */}
      {showSessionsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#07040f]/85 p-4 backdrop-blur-md"
          onClick={() => setShowSessionsModal(false)}
        >
          <div
            className="w-full max-w-md rounded-3xl border border-purple-900/60 bg-[#0d071a] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-purple-950 pb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-[#22d3ee]" />
                <h3 className="text-base font-bold text-white">Previous ZIPs & Sessions</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowSessionsModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-[#170b2e] hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 max-h-80 space-y-2.5 overflow-y-auto pr-1">
              {savedSessions.map((s) => (
                <div
                  key={s.id}
                  onClick={() => void handleLoadSavedSession(s)}
                  className="group flex cursor-pointer items-center justify-between rounded-2xl border border-purple-950 bg-[#170b2e]/60 p-3.5 transition-all hover:border-[#22d3ee]/60 hover:bg-[#170b2e]"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="truncate text-sm font-bold text-white group-hover:text-[#22d3ee]">
                      {s.title}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {s.stems.length} stems · {new Date(s.createdAt).toLocaleDateString()}{' '}
                      {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => void handleDeleteSavedSession(s.id, e)}
                    aria-label="Delete saved session"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-rose-950/50 hover:text-rose-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Band Practice Role Modal */}
      {showBandRoleModal && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-[#07040f]/80 backdrop-blur-md p-4">
          <div className="flex w-full max-w-md flex-col rounded-3xl border border-purple-900/60 bg-[#0d071a] p-6 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between border-b border-purple-950 pb-4">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-950 text-cyan-400">
                  <Sliders className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">What part are you in the band?</h3>
                  <p className="text-xs text-slate-400">Practice Mode: Sets your instrument to 100% and backing mix to 15%</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowBandRoleModal(false)}
                className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-purple-950 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              {[
                { name: 'Lead Vocals', icon: '🎤' },
                { name: 'Background Vocals', icon: '🎶' },
                { name: 'Electric Guitar', icon: '🎸' },
                { name: 'Acoustic Guitar', icon: '🪕' },
                { name: 'Piano / Keys', icon: '🎹' },
                { name: 'Bass', icon: '🎸' },
                { name: 'Drums', icon: '🥁' },
              ].map((role) => (
                <button
                  key={role.name}
                  type="button"
                  onClick={() => handleSelectBandRole(role.name)}
                  className={`flex items-center gap-3 rounded-2xl border p-3.5 text-left text-xs font-semibold transition-all ${
                    activeBandRole === role.name
                      ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300 shadow-lg'
                      : 'border-purple-900/60 bg-[#120924] text-slate-200 hover:bg-purple-950 hover:border-purple-800'
                  }`}
                >
                  <span className="text-xl">{role.icon}</span>
                  <span className="truncate">{role.name}</span>
                </button>
              ))}
            </div>

            {activeBandRole && (
              <div className="mt-4 pt-3 border-t border-purple-950 flex items-center justify-between">
                <span className="text-xs text-cyan-300 font-medium">Active: {activeBandRole}</span>
                <button
                  type="button"
                  onClick={handleClearBandRole}
                  className="inline-flex h-8 items-center gap-1 rounded-xl bg-rose-950/60 border border-rose-900/60 px-3 text-xs font-semibold text-rose-300 hover:bg-rose-900/60"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Reset Mix (100% All)</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ==========================================
          DESKTOP DAW VIEW (hidden md:flex)
         ========================================== */}
      <div className="hidden md:flex flex-1 flex-col h-dvh overflow-hidden bg-[#07040f]">
        {/* Desktop Header */}
        <header className="flex h-14 shrink-0 items-center justify-between border-b border-purple-950 bg-[#0a0612] px-6">
          <div className="flex items-center gap-4">
            <span className="text-base font-extrabold tracking-wider text-white">StemDeck</span>
            <span className="text-xs font-mono text-purple-400 bg-purple-950/60 px-2.5 py-1 rounded-lg">
              DAW Studio Mode
            </span>
          </div>

          <div className="flex items-center gap-3">
            {savedSessions.length > 0 && (
              <button
                type="button"
                onClick={() => setShowSessionsModal(true)}
                className="inline-flex h-9 items-center gap-2 rounded-xl border border-purple-900/60 bg-[#120924] px-3 text-xs font-semibold text-cyan-400 hover:bg-[#1f0f3d]"
              >
                <Clock className="h-4 w-4" />
                <span>Saved Sessions ({savedSessions.length})</span>
              </button>
            )}
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => setShowBandRoleModal(true)}
              className={`inline-flex h-9 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold shadow-lg transition-all ${
                activeBandRole
                  ? 'bg-cyan-400 text-slate-950 font-bold animate-pulse'
                  : 'border border-cyan-500/40 bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20'
              }`}
            >
              <Sliders className="h-4 w-4" />
              <span>{activeBandRole ? `Role: ${activeBandRole}` : 'Band Practice Role'}</span>
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 items-center gap-2 rounded-xl bg-[#7c3aed] px-4 text-xs font-semibold text-white shadow-lg hover:bg-[#6d28d9]"
            >
              <Plus className="h-4 w-4" />
              <span>Add Stems / ZIP</span>
            </button>
          </div>
        </header>

        {activeBandRole && stems.length > 0 && (
          <div className="bg-gradient-to-r from-purple-950 via-[#170b2e] to-cyan-950 border-b border-cyan-500/30 px-6 py-2 flex items-center justify-between gap-4 text-xs z-30 shrink-0">
            <div className="flex items-center gap-2">
              <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-ping" />
              <span className="font-bold text-white">Practice Mode:</span>
              <span className="text-cyan-300 font-semibold">{activeBandRole} (100%)</span>
              <span className="text-slate-400">· Backing mix @ 15%</span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowBandRoleModal(true)}
                className="text-xs font-semibold text-cyan-300 underline hover:text-cyan-200"
              >
                Change Role
              </button>
              <button
                type="button"
                onClick={handleClearBandRole}
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-cyan-500/20 border border-cyan-500/40 px-2.5 font-semibold text-cyan-200 hover:bg-cyan-500/30"
              >
                <span>Reset Mix</span>
              </button>
            </div>
          </div>
        )}

        {/* Desktop DAW Split Workspace */}
        {stems.length > 0 ? (
          <div className="flex flex-1 overflow-hidden pb-16">
            {/* Left Track Control Sidebar (Width ~320px) */}
            <aside className="w-80 shrink-0 flex flex-col border-r border-purple-950 bg-[#07040f] overflow-y-auto">
              <div className="flex h-12 items-center justify-between border-b border-purple-950 px-4 text-xs font-bold text-slate-400">
                <span>Tracks ({stems.length})</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={allMuted ? handleUnmuteAll : handleMuteAll}
                    className="text-[11px] font-semibold text-slate-300 hover:text-white"
                  >
                    {allMuted ? 'Unmute All' : 'Mute All'}
                  </button>
                </div>
              </div>

              <div className="flex flex-col">
                {sortedStems.map((stem) => {
                  const audible = isStemAudible(stem, anySoloed);
                  return (
                    <StemStrip
                      key={stem.id}
                      stem={stem}
                      isAudible={audible}
                      anySoloed={anySoloed}
                      totalDuration={totalDuration}
                      currentTime={currentTime}
                      isDark={true}
                      viewMode="desktop"
                      onToggleMute={handleToggleMute}
                      onToggleSolo={handleToggleSolo}
                      onVolumeChange={handleVolumeChange}
                      onCategoryChange={handleCategoryChange}
                      onRemove={handleRemoveStem}
                      onSeek={handleSeek}
                    />
                  );
                })}
              </div>
            </aside>

            {/* Right Waveform Timeline Area */}
            <section className="flex flex-1 flex-col overflow-y-auto overflow-x-hidden bg-[#07040f]">
              <div className="flex h-12 items-center justify-between border-b border-purple-950 px-6 text-xs font-mono text-slate-400">
                <span>Timeline · {formatTime(totalDuration)} total</span>
                <button
                  type="button"
                  onClick={() => void runAiClassification(stems)}
                  disabled={isClassifyingAll}
                  className="inline-flex h-7 items-center gap-1.5 rounded-lg bg-purple-950/80 px-2.5 text-[11px] font-semibold text-cyan-300 hover:bg-purple-900"
                >
                  {isClassifyingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                  <span>AI Stem ID</span>
                </button>
              </div>

              <div className="flex flex-col">
                {sortedStems.map((stem) => {
                  const audible = isStemAudible(stem, anySoloed);
                  return (
                    <div key={`wave-${stem.id}`} className="border-b border-purple-950/60">
                      <WaveformCanvas
                        peaks={stem.peaks}
                        stemDuration={stem.duration}
                        totalDuration={totalDuration}
                        currentTime={currentTime}
                        color={stem.color}
                        isAudible={audible}
                        volume={stem.volume}
                        stemName={stem.name}
                        isDark={true}
                        variant="desktop"
                        onSeek={handleSeek}
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          /* Desktop Empty State */
          <div className="flex flex-1 items-center justify-center p-8 bg-[#07040f]">
            <div className="flex max-w-lg flex-col items-center rounded-3xl border border-purple-900/60 bg-[#0d071a] p-12 text-center shadow-2xl">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-purple-950 text-cyan-400 shadow-xl">
                <FolderArchive className="h-8 w-8" />
              </div>
              <h2 className="mt-6 text-2xl font-bold tracking-tight text-white">
                Drop your Moises stems or ZIP export to start mixing
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-slate-400">
                Drag and drop audio stems or a ZIP archive to load them into the multitrack DAW timeline.
              </p>
              <div className="mt-8 flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isLoadingFiles}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-[#7c3aed] px-6 text-sm font-semibold text-white shadow-lg hover:bg-[#6d28d9] active:scale-98"
                >
                  <Upload className="h-4 w-4" />
                  <span>Select Audio Files or .ZIP</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleLoadDemoStems()}
                  disabled={isLoadingFiles}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl border border-purple-900/60 bg-[#120924] px-5 text-sm font-medium text-slate-200 hover:bg-[#1f0f3d]"
                >
                  <Music className="h-4 w-4" />
                  <span>Load Demo Session</span>
                </button>
              </div>

              {savedSessions.length > 0 && (
                <div className="mt-6 w-full border-t border-purple-950 pt-5">
                  <button
                    type="button"
                    onClick={() => setShowSessionsModal(true)}
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20"
                  >
                    <Clock className="h-4 w-4" />
                    <span>Open Previous Sessions ({savedSessions.length})</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Desktop DAW Bottom Transport Bar */}
        {stems.length > 0 && (
          <footer className="fixed bottom-0 left-0 right-0 z-50 flex h-16 shrink-0 items-center justify-between border-t border-purple-950 bg-[#0a0612] px-6 shadow-2xl">
            <div className="flex items-center gap-3 min-w-0 w-64">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-purple-950 text-cyan-400">
                <Music className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-white" title={sessionTitle}>
                  {sessionTitle}
                </p>
                <p className="text-[11px] text-purple-400">114 bpm / C · 16-bit WAV</p>
              </div>
            </div>

            <div className="flex flex-col items-center gap-1 max-w-md w-full px-4">
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => handleSkipSeconds(-10)}
                  className="text-xs font-mono font-bold text-slate-400 hover:text-white"
                >
                  -10s
                </button>
                <button
                  type="button"
                  onClick={togglePlayPause}
                  aria-label={isPlaying ? 'Pause' : 'Play'}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-[#7c3aed] text-white shadow-lg hover:bg-[#6d28d9] active:scale-95"
                >
                  {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 translate-x-0.5 fill-current" />}
                </button>
                <button
                  type="button"
                  onClick={() => handleSkipSeconds(10)}
                  className="text-xs font-mono font-bold text-slate-400 hover:text-white"
                >
                  +10s
                </button>
              </div>

              <div className="flex w-full items-center gap-2">
                <span className="font-mono text-[10px] text-slate-400 w-9 text-right">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={totalDuration || 1}
                  step={0.01}
                  value={Math.min(currentTime, totalDuration || 0)}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-cyan-400"
                />
                <span className="font-mono text-[10px] text-slate-400 w-9">{formatTime(totalDuration)}</span>
              </div>
            </div>

            <div className="flex items-center gap-3 w-64 justify-end">
              <button
                type="button"
                onClick={() => void handleExportMixdown()}
                disabled={isExporting || audibleStemCount === 0}
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#22d3ee] px-5 text-xs font-bold text-slate-950 shadow-lg hover:bg-[#06b6d4] active:scale-95 disabled:opacity-50"
              >
                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span>Export Mixdown (WAV)</span>
              </button>
            </div>
          </footer>
        )}
      </div>

      {/* ==========================================
          MOBILE MOISES VIEW (md:hidden)
         ========================================== */}
      <div className="flex md:hidden flex-1 flex-col bg-[#07040f]">
        <header className="safe-top sticky top-0 z-30 border-b border-purple-950 bg-[#0a0612]/95 px-4 py-3 backdrop-blur-md">
          <div className="mx-auto flex max-w-md items-center justify-between gap-3">
            <button
              type="button"
              onClick={handleClearAllStems}
              aria-label="Close session"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-[#170b2e] hover:text-white"
            >
              <ChevronDown className="h-5 w-5" />
            </button>

            <h1 className="truncate text-sm font-bold tracking-tight text-white">{sessionTitle}</h1>

            <div className="flex items-center gap-1">
              {savedSessions.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowSessionsModal(true)}
                  className="flex h-9 px-2.5 items-center gap-1 rounded-xl bg-[#120924] text-cyan-400 border border-purple-900/60 text-xs font-semibold"
                >
                  <Clock className="h-3.5 w-3.5" />
                  <span>{savedSessions.length}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowBandRoleModal(true)}
                className={`flex h-9 px-2.5 items-center gap-1 rounded-xl text-xs font-semibold ${
                  activeBandRole
                    ? 'bg-cyan-400 text-slate-950 font-bold'
                    : 'bg-[#120924] text-cyan-400 border border-purple-900/60'
                }`}
              >
                <Sliders className="h-3.5 w-3.5" />
                <span>{activeBandRole ? activeBandRole.split(' ')[0] : 'Role'}</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#7c3aed]/20 text-[#22d3ee]"
              >
                <Plus className="h-5 w-5" />
              </button>
            </div>
          </div>
        </header>

        {activeBandRole && stems.length > 0 && (
          <div className="bg-gradient-to-r from-purple-950 via-[#170b2e] to-cyan-950 border-b border-cyan-500/30 px-4 py-2 flex items-center justify-between gap-2 text-xs z-30 shrink-0">
            <div className="flex items-center gap-1.5 truncate">
              <span className="flex h-2 w-2 rounded-full bg-cyan-400 animate-ping shrink-0" />
              <span className="font-bold text-white shrink-0">Practice:</span>
              <span className="text-cyan-300 font-semibold truncate">{activeBandRole}</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setShowBandRoleModal(true)}
                className="text-[11px] font-semibold text-cyan-300 underline"
              >
                Change
              </button>
              <button
                type="button"
                onClick={handleClearBandRole}
                className="inline-flex h-6 items-center gap-1 rounded-md bg-cyan-500/20 border border-cyan-500/40 px-2 text-[11px] font-semibold text-cyan-200"
              >
                <span>Reset</span>
              </button>
            </div>
          </div>
        )}

        <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-3 px-4 py-3.5 pb-36">
          {errors.length > 0 && (
            <section aria-label="Errors" className="flex flex-col gap-2">
              {errors.map((err) => (
                <div key={err.id} role="alert" className="flex items-start justify-between gap-3 rounded-2xl border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-200">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
                    <p>{err.message}</p>
                  </div>
                  <button type="button" onClick={() => setErrors((prev) => prev.filter((item) => item.id !== err.id))} className="text-rose-400 hover:text-white">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </section>
          )}

          {isLoadingFiles && (
            <div role="status" className="flex items-center gap-2.5 rounded-2xl border border-purple-900/60 bg-[#120924] px-4 py-3 text-xs font-medium text-purple-200">
              <Loader2 className="h-4 w-4 animate-spin text-[#22d3ee]" />
              <span>{loadingStatus || 'Decoding audio stems...'}</span>
            </div>
          )}

          {exportSummary && (
            <div role="status" className="flex flex-col gap-2.5 rounded-2xl border border-emerald-900/60 bg-emerald-950/40 p-3.5 text-xs text-emerald-200">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                  <div className="space-y-0.5">
                    <p className="font-semibold break-all">Exported <span className="font-mono">{exportSummary.fileName}</span> (WAV)</p>
                  </div>
                </div>
                <button type="button" onClick={() => setExportSummary(null)} className="text-emerald-400 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {exportSummary.blob && (
                <div className="flex items-center gap-2 pt-1">
                  <button type="button" onClick={() => exportSummary.blob && triggerBlobDownload(exportSummary.blob, exportSummary.fileName)} className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white">
                    <Download className="h-3.5 w-3.5" />
                    <span>Download</span>
                  </button>
                  {supportsNativeShare && (
                    <button type="button" onClick={() => void handleNativeShareMixdown()} className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-700 bg-emerald-900/60 px-3 text-xs font-semibold text-emerald-200">
                      <Share2 className="h-3.5 w-3.5" />
                      <span>Share</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {stems.length > 0 ? (
            <section aria-label="Loaded stems" className="flex flex-col gap-2">
              {sortedStems.map((stem) => {
                const audible = isStemAudible(stem, anySoloed);
                return (
                  <StemStrip
                    key={stem.id}
                    stem={stem}
                    isAudible={audible}
                    anySoloed={anySoloed}
                    totalDuration={totalDuration}
                    currentTime={currentTime}
                    isDark={true}
                    viewMode="deck"
                    onToggleMute={handleToggleMute}
                    onToggleSolo={handleToggleSolo}
                    onVolumeChange={handleVolumeChange}
                    onCategoryChange={handleCategoryChange}
                    onRemove={handleRemoveStem}
                    onSeek={handleSeek}
                  />
                );
              })}

              <div className="mt-2 flex items-center justify-between gap-2 pt-1">
                <div className="flex items-center gap-1.5">
                  <button type="button" onClick={allMuted ? handleUnmuteAll : handleMuteAll} className="inline-flex h-8 items-center gap-1 rounded-xl border border-purple-900/60 bg-[#120924] px-3 text-xs font-medium text-slate-300">
                    {allMuted ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
                    <span>{allMuted ? 'Unmute' : 'Mute All'}</span>
                  </button>
                  <button type="button" onClick={() => void runAiClassification(stems)} disabled={isClassifyingAll} className="inline-flex h-8 items-center gap-1 rounded-xl border border-purple-900/60 bg-[#120924] px-3 text-xs font-semibold text-[#22d3ee] disabled:opacity-50">
                    {isClassifyingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wand2 className="h-3 w-3" />}
                    <span>AI ID</span>
                  </button>
                </div>
                <button type="button" onClick={() => fileInputRef.current?.click()} className="inline-flex h-8 items-center gap-1 rounded-xl border border-dashed border-purple-800 px-3 text-xs font-medium text-slate-400">
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add</span>
                </button>
              </div>
            </section>
          ) : (
            <section aria-label="Empty state" className="flex flex-1 flex-col items-center justify-center py-8">
              <div className="flex w-full flex-col items-center rounded-3xl border-2 border-dashed border-purple-900/60 bg-[#0d071a] p-8 text-center backdrop-blur-sm">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-purple-950 text-[#22d3ee] shadow-lg">
                  <FolderArchive className="h-7 w-7" />
                </div>
                <h2 className="mt-5 text-xl font-bold tracking-tight text-white">
                  Drop your Moises stems or ZIP export to start mixing
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-slate-400">
                  Drag and drop audio files or a ZIP archive to load them into the multitrack DAW timeline.
                </p>
                <div className="mt-6 flex w-full flex-col gap-2.5">
                  <button type="button" onClick={() => fileInputRef.current?.click()} disabled={isLoadingFiles} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-[#7c3aed] font-semibold text-white shadow-lg hover:bg-[#6d28d9] active:scale-98 disabled:opacity-50">
                    <Upload className="h-4 w-4" />
                    <span>Select Audio Files or .ZIP</span>
                  </button>
                  <button type="button" onClick={() => void handleLoadDemoStems()} disabled={isLoadingFiles} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-purple-900/60 bg-[#120924] font-medium text-slate-200 hover:bg-[#1f0f3d] active:scale-98 disabled:opacity-50">
                    <Music className="h-4 w-4" />
                    <span>Load Demo Session</span>
                  </button>
                </div>

                {savedSessions.length > 0 && (
                  <div className="mt-6 w-full border-t border-purple-950 pt-4">
                    <button type="button" onClick={() => setShowSessionsModal(true)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 text-xs font-semibold text-cyan-300">
                      <Clock className="h-4 w-4" />
                      <span>Previous Sessions ({savedSessions.length})</span>
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </main>

        {stems.length > 0 && (
          <footer className="safe-bottom-bar fixed bottom-0 left-0 right-0 z-40 border-t border-purple-950 bg-[#0a0612]/95 backdrop-blur-xl">
            <div className="mx-auto flex max-w-md flex-col gap-2.5 px-4 py-3">
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-[11px] text-slate-400 shrink-0">{formatTime(currentTime)}</span>
                <input
                  type="range"
                  min={0}
                  max={totalDuration || 1}
                  step={0.01}
                  value={Math.min(currentTime, totalDuration || 0)}
                  onChange={(e) => handleSeek(Number(e.target.value))}
                  className="h-6 w-full cursor-pointer appearance-none rounded-full bg-slate-900 accent-cyan-400"
                />
                <span className="font-mono text-[11px] text-slate-500 shrink-0">-{formatTime(Math.max(0, totalDuration - currentTime))}</span>
              </div>

              <div className="flex items-center justify-center gap-6">
                <button type="button" onClick={() => handleSkipSeconds(-10)} className="text-xs font-bold text-slate-300">-10s</button>
                <button type="button" onClick={togglePlayPause} className="flex h-12 w-12 items-center justify-center rounded-full bg-[#7c3aed] text-white shadow-xl">
                  {isPlaying ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 translate-x-0.5 fill-current" />}
                </button>
                <button type="button" onClick={() => handleSkipSeconds(10)} className="text-xs font-bold text-slate-300">+10s</button>
              </div>

              <div className="flex items-center justify-between border-t border-purple-950 pt-2 text-xs">
                <div className="flex items-center gap-1.5 text-slate-400">
                  <Layers className="h-4 w-4 text-[#22d3ee]" />
                  <span>{audibleStemCount}/{stems.length} Active</span>
                </div>
                <button type="button" onClick={() => void handleExportMixdown()} disabled={isExporting || audibleStemCount === 0} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[#22d3ee] px-4 font-semibold text-slate-950 shadow-md hover:bg-[#06b6d4] disabled:opacity-50">
                  {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  <span>Export WAV</span>
                </button>
              </div>
            </div>
          </footer>
        )}
      </div>
    </div>
  );
}
