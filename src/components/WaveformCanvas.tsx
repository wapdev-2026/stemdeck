import React, { useEffect, useRef, useState } from 'react';
import { formatTime } from '../utils/audioUtils';

interface WaveformCanvasProps {
  peaks: number[];
  stemDuration: number;
  totalDuration: number;
  currentTime: number;
  color: string;
  isAudible: boolean;
  volume: number;
  stemName: string;
  isDark: boolean;
  variant?: 'deck' | 'mixer';
  labelOverlay?: string;
  onSeek: (newTime: number) => void;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  peaks,
  stemDuration,
  totalDuration,
  currentTime,
  color,
  isAudible,
  volume,
  stemName,
  isDark,
  variant = 'deck',
  labelOverlay,
  onSeek,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number }>({
    width: 600,
    height: 64,
  });
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setCanvasSize({
          width: Math.floor(rect.width),
          height: Math.floor(rect.height),
        });
      }
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvasSize;

    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, width, height);

    const centerY = height / 2;
    const padX = variant === 'deck' ? 14 : 6;
    const usableWidth = Math.max(10, width - padX * 2);

    const stemWidthRatio = totalDuration > 0 ? Math.min(1, stemDuration / totalDuration) : 1;
    const activePixelWidth = usableWidth * stemWidthRatio;
    const playheadRatio = totalDuration > 0 ? Math.max(0, Math.min(1, currentTime / totalDuration)) : 0;
    const playheadX = padX + playheadRatio * usableWidth;

    // Horizontal center line (split into played highlight and unplayed color in deck mode)
    if (variant === 'deck') {
      // Played center line
      ctx.strokeStyle = isAudible ? '#facc15' : isDark ? 'rgba(148,163,184,0.2)' : 'rgba(100,116,139,0.25)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padX, centerY);
      ctx.lineTo(playheadX, centerY);
      ctx.stroke();

      // Unplayed center line
      ctx.strokeStyle = isAudible
        ? `${color}99`
        : isDark
        ? 'rgba(148, 163, 184, 0.16)'
        : 'rgba(100, 116, 139, 0.2)';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(playheadX, centerY);
      ctx.lineTo(width - padX, centerY);
      ctx.stroke();
    } else {
      ctx.strokeStyle = isDark ? 'rgba(148, 163, 184, 0.14)' : 'rgba(100, 116, 139, 0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();
    }

    if (peaks.length === 0 || totalDuration <= 0) return;

    const barWidth = variant === 'deck' ? 2.5 : 2;
    const barGap = variant === 'deck' ? 2 : 1.5;
    const step = barWidth + barGap;
    const totalBars = Math.max(1, Math.floor(activePixelWidth / step));

    const visualGain = Math.min(1.35, Math.max(0.12, volume));
    const maxAmplitudeHeight = (height / 2) * 0.82;

    const playedColor = isAudible
      ? variant === 'deck'
        ? '#facc15' // Warm gold played indicator like the reference mobile view
        : color
      : isDark
      ? 'rgba(148, 163, 184, 0.28)'
      : 'rgba(100, 116, 139, 0.32)';

    const unplayedColor = isAudible
      ? variant === 'deck'
        ? color
        : isDark
        ? 'rgba(148, 163, 184, 0.38)'
        : 'rgba(100, 116, 139, 0.42)'
      : isDark
      ? 'rgba(100, 116, 139, 0.18)'
      : 'rgba(148, 163, 184, 0.22)';

    for (let i = 0; i < totalBars; i++) {
      const x = padX + i * step;
      const peakIndex = Math.min(
        peaks.length - 1,
        Math.floor((i / totalBars) * peaks.length)
      );
      const rawPeak = peaks[peakIndex] || 0;
      const scaledPeak = Math.min(1, rawPeak * visualGain);

      // Keep truly quiet passages clean and flat along the center line like the screenshot
      if (scaledPeak < 0.035) {
        continue;
      }

      const halfBarHeight = Math.max(2, scaledPeak * maxAmplitudeHeight);

      ctx.fillStyle = x <= playheadX ? playedColor : unplayedColor;
      ctx.beginPath();
      ctx.roundRect(x, centerY - halfBarHeight, barWidth, halfBarHeight * 2, 1.25);
      ctx.fill();
    }

    if (hoverTime !== null && totalDuration > 0) {
      const hoverRatio = Math.max(0, Math.min(1, hoverTime / totalDuration));
      const hoverX = padX + hoverRatio * usableWidth;
      ctx.strokeStyle = isDark ? 'rgba(226, 232, 240, 0.3)' : 'rgba(15, 23, 42, 0.25)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hoverX, 4);
      ctx.lineTo(hoverX, height - 4);
      ctx.stroke();
    }

    // Playhead vertical bar
    if (currentTime > 0 && isAudible) {
      ctx.strokeStyle = variant === 'deck' ? '#fde047' : isDark ? '#f8fafc' : '#0f172a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 4);
      ctx.lineTo(playheadX, height - 4);
      ctx.stroke();
    }
  }, [
    peaks,
    stemDuration,
    totalDuration,
    currentTime,
    color,
    isAudible,
    volume,
    isDark,
    canvasSize,
    hoverTime,
    variant,
  ]);

  const computeTimeFromClientX = (clientX: number): number => {
    const el = containerRef.current;
    if (!el || totalDuration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const padX = variant === 'deck' ? 14 : 6;
    const usableWidth = Math.max(10, rect.width - padX * 2);
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left - padX) / usableWidth));
    return ratio * totalDuration;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (totalDuration <= 0) return;
    isDraggingRef.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const targetTime = computeTimeFromClientX(e.clientX);
    onSeek(targetTime);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (totalDuration <= 0) return;
    const t = computeTimeFromClientX(e.clientX);
    setHoverTime(t);
    if (isDraggingRef.current) {
      onSeek(t);
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingRef.current) {
      isDraggingRef.current = false;
      setHoverTime(null);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Ignore
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (totalDuration <= 0) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      onSeek(Math.min(totalDuration, currentTime + 2));
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      onSeek(Math.max(0, currentTime - 2));
    }
  };

  // Dynamic capsule surface styling for Deck mode
  const deckCapsuleStyle: React.CSSProperties =
    variant === 'deck'
      ? isAudible
        ? {
            backgroundColor: isDark ? `${color}24` : `${color}16`,
            borderColor: isDark ? `${color}66` : `${color}55`,
          }
        : {
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.45)' : 'rgba(241, 245, 249, 0.7)',
            borderColor: isDark ? 'rgba(51, 65, 85, 0.45)' : 'rgba(203, 213, 225, 0.6)',
          }
      : {};

  return (
    <div
      ref={containerRef}
      role="slider"
      tabIndex={0}
      aria-label={`${stemName} waveform seek bar`}
      aria-valuemin={0}
      aria-valuemax={Math.round(totalDuration)}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={`${formatTime(currentTime)} of ${formatTime(totalDuration)}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={() => setHoverTime(null)}
      onKeyDown={handleKeyDown}
      style={deckCapsuleStyle}
      className={`landscape-compact-waveform relative w-full cursor-pointer select-none touch-pan-y overflow-hidden transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
        variant === 'deck'
          ? 'h-16 sm:h-18 rounded-2xl border-2'
          : 'h-13 sm:h-15 rounded-xl bg-slate-100/80 dark:bg-slate-900/90'
      }`}
      title={`Tap or drag to seek (${formatTime(currentTime)} / ${formatTime(totalDuration)})`}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />

      {/* Subtle Stem Label & Volume % Overlay inside the Deck Capsule */}
      {labelOverlay && (
        <div className="pointer-events-none absolute left-3 top-1.5 flex items-center gap-1.5">
          <span
            className={`text-[11px] font-semibold tracking-tight ${
              isAudible
                ? 'text-slate-800/90 dark:text-slate-100/90'
                : 'text-slate-400 dark:text-slate-500'
            }`}
          >
            {labelOverlay}
          </span>
        </div>
      )}

      {hoverTime !== null && (
        <span className="pointer-events-none absolute right-2.5 top-1.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">
          {formatTime(hoverTime, true)}
        </span>
      )}
    </div>
  );
};
