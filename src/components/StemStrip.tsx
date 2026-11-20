import React, { useState } from 'react';
import {
  AudioLines,
  ChevronDown,
  ChevronUp,
  Drum,
  Guitar,
  Loader2,
  Mic,
  Music2,
  Piano,
  Radio,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { Stem, StemCategory } from '../types/stem';
import {
  ALL_STEM_CATEGORIES,
  formatTime,
  VOLUME_PRESETS,
} from '../utils/audioUtils';
import { WaveformCanvas } from './WaveformCanvas';

interface StemStripProps {
  stem: Stem;
  isAudible: boolean;
  anySoloed: boolean;
  totalDuration: number;
  currentTime: number;
  isDark: boolean;
  viewMode: 'deck' | 'mixer';
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
  onSeek,
}) => {
  const [showExtras, setShowExtras] = useState(false);
  const volumePercent = Math.round(stem.volume * 100);
  const silencedBySolo = anySoloed && !stem.soloed;
  const effectiveAudible = isAudible && stem.volume > 0;

  // DECK VIEW (Matches the user's mobile screenshot: [Instrument Icon] [Rounded Waveform Capsule] [Speaker Icon])
  if (viewMode === 'deck') {
    const capsuleLabel = `${stem.name}${
      !effectiveAudible
        ? stem.muted
          ? ' · Muted'
          : silencedBySolo
          ? ' · Silent'
          : ' · 0%'
        : volumePercent !== 100
        ? ` · ${volumePercent}%`
        : ''
    }${stem.soloed ? ' · Solo' : ''}`;

    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Left: Instrument Icon Button (Tap to Mute / Unmute) */}
          <button
            type="button"
            onClick={() => onToggleMute(stem.id)}
            aria-pressed={stem.muted}
            aria-label={`${stem.muted ? 'Unmute' : 'Mute'} ${stem.name}`}
            title={`Tap to ${stem.muted ? 'unmute' : 'mute'} ${stem.name}`}
            style={{
              color: effectiveAudible ? stem.color : undefined,
            }}
            className={`relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition-all active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              effectiveAudible
                ? 'bg-slate-100/90 hover:bg-slate-200/80 dark:bg-slate-900/90 dark:hover:bg-slate-800'
                : 'bg-slate-100/40 text-slate-400 opacity-50 dark:bg-slate-900/40 dark:text-slate-600'
            }`}
          >
            {stem.isClassifying ? (
              <Loader2 className="h-5 w-5 animate-spin text-indigo-500" />
            ) : (
              getCategoryIcon(stem.category, 'h-5 w-5')
            )}
            {/* Diagonal slash overlay when muted/silent, just like the 2nd row in the screenshot */}
            {!effectiveAudible && (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute h-0.5 w-6 rotate-45 rounded-full bg-slate-400 dark:bg-slate-500"
              />
            )}
          </button>

          {/* Center: Rounded Tinted Waveform Capsule */}
          <div className="min-w-0 flex-1">
            <WaveformCanvas
              peaks={stem.peaks}
              stemDuration={stem.duration}
              totalDuration={totalDuration}
              currentTime={currentTime}
              color={stem.color}
              isAudible={effectiveAudible}
              volume={stem.volume}
              stemName={stem.name}
              isDark={isDark}
              variant="deck"
              labelOverlay={capsuleLabel}
              onSeek={onSeek}
            />
          </div>

          {/* Right: Speaker Icon Button (Tap to expand Volume Fader, 10%/15% Presets, Role & Solo) */}
          <button
            type="button"
            onClick={() => setShowExtras((prev) => !prev)}
            aria-expanded={showExtras}
            aria-label={`Adjust volume and presets for ${stem.name} (${volumePercent}%)`}
            title={`Tap to adjust volume (${volumePercent}%), presets, role, or solo`}
            style={{
              color: showExtras || effectiveAudible ? stem.color : undefined,
            }}
            className={`relative flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-2xl transition-all active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              showExtras
                ? 'bg-indigo-50 ring-2 ring-indigo-500/60 dark:bg-indigo-950/70'
                : effectiveAudible
                ? 'bg-slate-100/90 hover:bg-slate-200/80 dark:bg-slate-900/90 dark:hover:bg-slate-800'
                : 'bg-slate-100/40 text-slate-400 opacity-50 dark:bg-slate-900/40 dark:text-slate-600'
            }`}
          >
            {!effectiveAudible ? (
              <VolumeX className="h-5 w-5" />
            ) : volumePercent < 50 ? (
              <Volume1 className="h-5 w-5" />
            ) : (
              <Volume2 className="h-5 w-5" />
            )}
            <span className="font-mono text-[9px] font-bold leading-none opacity-85">
              {volumePercent}%
            </span>
          </button>
        </div>

        {/* Collapsible Popover Drawer when Right Speaker Icon is tapped (Responsive width on iPhone/Android) */}
        {showExtras && (
          <div className="mx-1 sm:mx-12 flex flex-col gap-2.5 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/95">
            {/* Row 1: M, S, Volume Fader Slider, Percentage readout */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onToggleMute(stem.id)}
                aria-pressed={stem.muted}
                className={`flex h-9 px-3 shrink-0 items-center justify-center rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap active:scale-95 ${
                  stem.muted
                    ? 'border-rose-600 bg-rose-600 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {stem.muted ? 'Muted' : 'Mute'}
              </button>

              <button
                type="button"
                onClick={() => onToggleSolo(stem.id)}
                aria-pressed={stem.soloed}
                className={`flex h-9 px-3 shrink-0 items-center justify-center rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap active:scale-95 ${
                  stem.soloed
                    ? 'border-amber-500 bg-amber-500 text-slate-950'
                    : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                Solo
              </button>

              <input
                type="range"
                min={0}
                max={150}
                step={1}
                value={volumePercent}
                aria-label={`${stem.name} volume (${volumePercent}%)`}
                onChange={(e) => onVolumeChange(stem.id, Number(e.target.value) / 100)}
                className="stem-slider mx-1 h-8 min-w-0 flex-1 rounded-lg bg-slate-200 text-indigo-600 dark:bg-slate-800 dark:text-indigo-400"
              />

              <span className="w-11 shrink-0 text-right font-mono text-xs font-semibold text-slate-800 dark:text-slate-200">
                {volumePercent}%
              </span>
            </div>

            {/* Row 2: Quick Volume % Preset Buttons (0%, 10%, 15%, 25%, 50%, 75%, 100%, 125%, 150%) */}
            <div
              className="no-scrollbar flex items-center gap-1.5 overflow-x-auto py-0.5"
              role="group"
              aria-label={`Quick volume presets for ${stem.name}`}
            >
              {VOLUME_PRESETS.map((preset) => {
                const isActive = volumePercent === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => onVolumeChange(stem.id, preset / 100)}
                    aria-pressed={isActive}
                    className={`min-h-[34px] rounded-xl px-2.5 py-1 font-mono text-xs font-medium transition-colors whitespace-nowrap shrink-0 active:scale-95 ${
                      isActive
                        ? 'bg-indigo-600 text-white dark:bg-indigo-500'
                        : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                    }`}
                  >
                    {preset}%
                  </button>
                );
              })}
            </div>

            {/* Row 3: Role Switcher Pills (AI verified or one-tap override) & Remove */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2 dark:border-slate-800/80">
              <div className="no-scrollbar flex items-center gap-1 overflow-x-auto py-0.5">
                <span className="mr-1 inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                  <Sparkles className="h-3 w-3 text-indigo-400" />
                  <span>Role:</span>
                </span>
                {ALL_STEM_CATEGORIES.map((cat) => {
                  const isCurrent = stem.category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => onCategoryChange(stem.id, cat)}
                      aria-pressed={isCurrent}
                      className={`min-h-[30px] rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 active:scale-95 ${
                        isCurrent
                          ? 'bg-slate-900 text-white dark:bg-amber-400 dark:text-slate-950'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {cat === 'Background' ? 'B.Vocals' : cat}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => onRemove(stem.id)}
                aria-label={`Remove ${stem.name}`}
                className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-medium text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-950/50 shrink-0"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // MIXER VIEW (Full faders + M/S + Waveform side-by-side)
  return (
    <div
      className={`group flex flex-col gap-2 rounded-2xl border p-3 sm:p-3.5 transition-opacity duration-150 ${
        isAudible
          ? 'border-slate-200 bg-white opacity-100 dark:border-slate-800 dark:bg-slate-900/75'
          : 'border-slate-200/70 bg-slate-100/60 opacity-55 dark:border-slate-800/60 dark:bg-slate-900/35'
      }`}
    >
      <div className="landscape-compact-strip flex flex-col gap-2.5 md:flex-row md:items-center md:gap-4">
        <div className="landscape-compact-controls flex flex-col gap-2 md:w-72 lg:w-80 md:shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1.5">
              <span
                className="h-3.5 w-1.5 shrink-0 rounded-sm"
                style={{ backgroundColor: stem.color }}
                aria-hidden="true"
              />
              {getCategoryIcon(stem.category, 'h-4 w-4 shrink-0')}
              <h3
                className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100"
                title={stem.name}
              >
                {stem.name}
              </h3>
              {stem.isClassifying && (
                <Loader2
                  className="h-3 w-3 shrink-0 animate-spin text-indigo-500"
                  aria-label="AI identifying stem"
                />
              )}
              {!isAudible && (
                <span className="ml-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 shrink-0">
                  ({stem.muted ? 'Muted' : silencedBySolo ? 'Silent' : '0%'})
                </span>
              )}
            </div>

            <span className="shrink-0 font-mono text-[11px] text-slate-400 dark:text-slate-500">
              {formatTime(stem.duration)}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onToggleMute(stem.id)}
              aria-pressed={stem.muted}
              aria-label={`Mute ${stem.name}`}
              className={`flex h-9 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                stem.muted
                  ? 'border-rose-600 bg-rose-600 text-white hover:bg-rose-500 dark:border-rose-500 dark:bg-rose-600'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              M
            </button>

            <button
              type="button"
              onClick={() => onToggleSolo(stem.id)}
              aria-pressed={stem.soloed}
              aria-label={`Solo ${stem.name}`}
              className={`flex h-9 w-10 shrink-0 items-center justify-center rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                stem.soloed
                  ? 'border-amber-500 bg-amber-500 text-slate-950 hover:bg-amber-400'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              S
            </button>

            <input
              type="range"
              min={0}
              max={150}
              step={1}
              value={volumePercent}
              aria-label={`${stem.name} volume (${volumePercent}%)`}
              onChange={(e) => onVolumeChange(stem.id, Number(e.target.value) / 100)}
              onDoubleClick={() => onVolumeChange(stem.id, 1.0)}
              className="stem-slider mx-1 h-8 min-w-0 flex-1 rounded-lg bg-slate-200 text-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 dark:bg-slate-800 dark:text-indigo-400"
            />

            <button
              type="button"
              onClick={() => setShowExtras((prev) => !prev)}
              aria-expanded={showExtras}
              className={`inline-flex h-9 items-center justify-center gap-0.5 rounded-xl border px-2 font-mono text-xs font-semibold transition-colors whitespace-nowrap shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                showExtras
                  ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500 dark:bg-indigo-950/70 dark:text-indigo-300'
                  : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              <span>{volumePercent}%</span>
              {showExtras ? (
                <ChevronUp className="h-3.5 w-3.5 opacity-75" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 opacity-75" />
              )}
            </button>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <WaveformCanvas
            peaks={stem.peaks}
            stemDuration={stem.duration}
            totalDuration={totalDuration}
            currentTime={currentTime}
            color={stem.color}
            isAudible={effectiveAudible}
            volume={stem.volume}
            stemName={stem.name}
            isDark={isDark}
            variant="mixer"
            onSeek={onSeek}
          />
        </div>
      </div>

      {showExtras && (
        <div className="flex flex-col gap-2.5 border-t border-slate-100 pt-2.5 dark:border-slate-800/80">
          <div
            className="no-scrollbar flex items-center gap-1.5 overflow-x-auto py-0.5"
            role="group"
            aria-label={`Quick volume presets for ${stem.name}`}
          >
            <span className="mr-0.5 text-[11px] font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
              Preset:
            </span>
            {VOLUME_PRESETS.map((preset) => {
              const isActive = volumePercent === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onVolumeChange(stem.id, preset / 100)}
                  aria-pressed={isActive}
                  className={`min-h-[32px] rounded-lg px-2.5 py-1 font-mono text-xs font-medium transition-colors whitespace-nowrap shrink-0 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                    isActive
                      ? 'bg-indigo-600 text-white dark:bg-indigo-500 dark:text-white'
                      : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700 dark:hover:text-slate-100'
                  }`}
                >
                  {preset}%
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="no-scrollbar flex items-center gap-1 overflow-x-auto py-0.5">
              <span className="mr-1 text-[11px] font-medium text-slate-400 dark:text-slate-500 whitespace-nowrap shrink-0">
                Role:
              </span>
              {ALL_STEM_CATEGORIES.map((cat) => {
                const isCurrent = stem.category === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => onCategoryChange(stem.id, cat)}
                    aria-pressed={isCurrent}
                    className={`min-h-[28px] rounded-lg px-2 py-0.5 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 active:scale-95 ${
                      isCurrent
                        ? 'bg-slate-900 text-white dark:bg-amber-400 dark:text-slate-950'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {cat === 'Background' ? 'B.Vocals' : cat}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => onVolumeChange(stem.id, 1.0)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100 active:scale-95 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <RotateCcw className="h-3 w-3" />
                <span>100%</span>
              </button>

              <button
                type="button"
                onClick={() => onRemove(stem.id)}
                aria-label={`Remove ${stem.name}`}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/70 px-2.5 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-100 active:scale-95 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-400"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Remove</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
