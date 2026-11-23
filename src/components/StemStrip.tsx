import React, { useState } from 'react';
import {
  AudioLines,
  Drum,
  Guitar,
  Loader2,
  Mic,
  Music2,
  MoreHorizontal,
  Piano,
  Radio,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { Stem, StemCategory } from '../types/stem';
import {
  ALL_STEM_CATEGORIES,
  VOLUME_PRESETS,
} from '../utils/audioUtils';

interface StemStripProps {
  stem: Stem;
  isAudible: boolean;
  anySoloed: boolean;
  totalDuration: number;
  currentTime: number;
  isDark: boolean;
  viewMode: 'deck' | 'mixer' | 'desktop';
  onToggleMute: (id: string) => void;
  onToggleSolo: (id: string) => void;
  onVolumeChange: (id: string, volume: number) => void;
  onCategoryChange: (id: string, category: StemCategory) => void;
  onRemove: (id: string) => void;
  onSeek: (newTime: number) => void;
}

function getCategoryIcon(category?: StemCategory, className = 'h-5 w-5') {
  switch (category) {
    case 'Vocals':
      return <Mic className={className} aria-hidden="true" />;
    case 'Background':
      return <Users className={className} aria-hidden="true" />;
    case 'Drums':
      return <Drum className={className} aria-hidden="true" />;
    case 'Bass':
      return <AudioLines className={className} aria-hidden="true" />;
    case 'Guitar':
      return <Guitar className={className} aria-hidden="true" />;
    case 'Keys':
      return <Piano className={className} aria-hidden="true" />;
    case 'Synth':
      return <Radio className={className} aria-hidden="true" />;
    default:
      return <Music2 className={className} aria-hidden="true" />;
  }
}

export const StemStrip: React.FC<StemStripProps> = ({
  stem,
  isAudible,
  anySoloed,
  totalDuration,
  currentTime,
  isDark,
  viewMode,
  onToggleMute,
  onToggleSolo,
  onVolumeChange,
  onCategoryChange,
  onRemove,
}) => {
  const [showExtras, setShowExtras] = useState(false);
  const volumePercent = Math.round(stem.volume * 100);
  const effectiveAudible = isAudible && stem.volume > 0;

  // DESKTOP DAW VIEW (Left sidebar control strip matching reference screenshot)
  if (viewMode === 'desktop') {
    return (
      <div className="flex h-20 items-center justify-between gap-3 border-b border-slate-800 bg-[#07040f] px-4 py-2 text-slate-200">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="truncate text-xs font-bold text-white" title={stem.name}>
              {stem.name}
            </span>
            <span className="font-mono text-[11px] text-cyan-400">{volumePercent}%</span>
          </div>

          <div className="flex items-center gap-2.5">
            <input
              type="range"
              min={0}
              max={150}
              step={1}
              value={volumePercent}
              onChange={(e) => onVolumeChange(stem.id, Number(e.target.value) / 100)}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-800 accent-cyan-400"
              style={{
                background: `linear-gradient(to right, #22d3ee 0%, #22d3ee ${Math.min(
                  100,
                  (volumePercent / 150) * 100
                )}%, #1e293b ${Math.min(
                  100,
                  (volumePercent / 150) * 100
                )}%, #1e293b 100%)`,
              }}
            />

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onToggleMute(stem.id)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold ${
                  stem.muted
                    ? 'bg-rose-600 text-white border-rose-600'
                    : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                M
              </button>
              <button
                type="button"
                onClick={() => onToggleSolo(stem.id)}
                className={`flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-bold ${
                  stem.soloed
                    ? 'bg-amber-500 text-slate-950 border-amber-500'
                    : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                }`}
              >
                S
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // MOBILE DECK VIEW (Moises mobile style)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-3 rounded-2xl bg-[#0d071a] px-3.5 py-3 border border-purple-950/60 backdrop-blur-sm transition-all">
        <button
          type="button"
          onClick={() => onToggleMute(stem.id)}
          aria-pressed={stem.muted}
          aria-label={`${stem.muted ? 'Unmute' : 'Mute'} ${stem.name}`}
          style={{
            color: effectiveAudible ? '#22d3ee' : undefined,
          }}
          className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all active:scale-90 ${
            effectiveAudible
              ? 'bg-[#170b2e] text-cyan-400 hover:bg-[#200f40]'
              : 'bg-slate-800/40 text-slate-500 opacity-50'
          }`}
        >
          {stem.isClassifying ? (
            <Loader2 className="h-5 w-5 animate-spin text-cyan-400" />
          ) : (
            getCategoryIcon(stem.category, 'h-5 w-5')
          )}
          {!effectiveAudible && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute h-0.5 w-6 rotate-45 rounded-full bg-slate-400"
            />
          )}
        </button>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5 px-1">
          <div className="flex items-center justify-between text-[11px] font-medium text-slate-300">
            <span className="truncate font-semibold tracking-tight text-white" title={stem.name}>
              {stem.name}
            </span>
            <span className="font-mono text-cyan-400 shrink-0">
              {!effectiveAudible ? (stem.muted ? 'Muted' : '0%') : `${volumePercent}%`}
            </span>
          </div>

          <div className="relative flex items-center">
            <input
              type="range"
              min={0}
              max={150}
              step={1}
              value={volumePercent}
              onChange={(e) => onVolumeChange(stem.id, Number(e.target.value) / 100)}
              className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-900 accent-cyan-400"
              style={{
                background: `linear-gradient(to right, #22d3ee 0%, #22d3ee ${Math.min(
                  100,
                  (volumePercent / 150) * 100
                )}%, #1e293b ${Math.min(
                  100,
                  (volumePercent / 150) * 100
                )}%, #1e293b 100%)`,
              }}
            />
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowExtras((prev) => !prev)}
          aria-expanded={showExtras}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#170b2e] text-slate-400 transition-colors hover:bg-[#200f40] hover:text-white"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      {showExtras && (
        <div className="mx-2 flex flex-col gap-2.5 rounded-2xl border border-purple-900/40 bg-[#0d071a] p-3.5 shadow-xl backdrop-blur-md">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleMute(stem.id)}
                className={`flex h-8 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                  stem.muted
                    ? 'border-rose-600 bg-rose-600 text-white'
                    : 'border-purple-900/60 bg-[#170b2e] text-slate-200'
                }`}
              >
                {stem.muted ? 'Muted' : 'Mute'}
              </button>

              <button
                type="button"
                onClick={() => onToggleSolo(stem.id)}
                className={`flex h-8 px-3 rounded-xl border text-xs font-semibold transition-colors ${
                  stem.soloed
                    ? 'border-amber-500 bg-amber-500 text-slate-950'
                    : 'border-purple-900/60 bg-[#170b2e] text-slate-200'
                }`}
              >
                Solo
              </button>
            </div>

            <button
              type="button"
              onClick={() => onRemove(stem.id)}
              className="inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-medium text-rose-400 hover:bg-rose-950/50"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Remove</span>
            </button>
          </div>

          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto py-0.5">
            {VOLUME_PRESETS.map((preset) => {
              const isActive = volumePercent === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onVolumeChange(stem.id, preset / 100)}
                  className={`min-h-[30px] rounded-xl px-2.5 py-1 font-mono text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'bg-[#170b2e] text-slate-300 hover:bg-[#200f40]'
                  }`}
                >
                  {preset}%
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1 border-t border-purple-950/60 pt-2">
            <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400">
              <Sparkles className="h-3 w-3 text-cyan-400" />
              <span>Role:</span>
            </span>
            {ALL_STEM_CATEGORIES.map((cat) => {
              const isCurrent = stem.category === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => onCategoryChange(stem.id, cat)}
                  className={`min-h-[28px] rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                    isCurrent
                      ? 'bg-cyan-400 text-slate-950 font-bold'
                      : 'bg-[#170b2e] text-slate-300 hover:bg-[#200f40]'
                  }`}
                >
                  {cat === 'Background' ? 'B.Vocals' : cat}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
