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
  variant?: 'deck' | 'mixer' | 'desktop';
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
    width: 800,
    height: 80,
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
    const padX = variant === 'deck' ? 14 : 0;
    const usableWidth = Math.max(10, width - padX * 2);

    const stemWidthRatio = totalDuration > 0 ? Math.min(1, stemDuration / totalDuration) : 1;
    const activePixelWidth = usableWidth * stemWidthRatio;
    const playheadRatio = totalDuration > 0 ? Math.max(0, Math.min(1, currentTime / totalDuration)) : 0;
    const playheadX = padX + playheadRatio * usableWidth;

    // Background & center line
    if (variant === 'desktop') {
      ctx.fillStyle = isAudible ? '#06b6d415' : '#1e293b20';
      ctx.fillRect(0, 0, width, height);

      ctx.strokeStyle = '#33415555';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();
    }

    if (peaks.length === 0 || totalDuration <= 0) return;

    const barWidth = variant === 'desktop' ? 3 : 2;
    const barGap = variant === 'desktop' ? 2 : 1.5;
    const step = barWidth + barGap;
    const totalBars = Math.max(1, Math.floor(activePixelWidth / step));

    const visualGain = Math.min(1.35, Math.max(0.12, volume));
    const maxAmplitudeHeight = (height / 2) * 0.82;

    const waveColor = variant === 'desktop' ? (isAudible ? '#22d3ee' : '#475569') : color;

    for (let i = 0; i < totalBars; i++) {
      const x = padX + i * step;
      const peakIndex = Math.min(
        peaks.length - 1,
        Math.floor((i / totalBars) * peaks.length)
      );
      const rawPeak = peaks[peakIndex] || 0;
      const scaledPeak = Math.min(1, rawPeak * visualGain);

      if (scaledPeak < 0.035) continue;

      const halfBarHeight = Math.max(2, scaledPeak * maxAmplitudeHeight);

      ctx.fillStyle = waveColor;
      ctx.beginPath();
      ctx.roundRect(x, centerY - halfBarHeight, barWidth, halfBarHeight * 2, 1.5);
      ctx.fill();
    }

    // Playhead vertical line across track
    if (currentTime > 0 && isAudible) {
      ctx.strokeStyle = variant === 'desktop' ? '#ffffff' : '#fde047';
      ctx.lineWidth = variant === 'desktop' ? 2 : 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
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
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
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
      style={
        variant === 'desktop'
          ? {
              backgroundColor: isAudible ? '#082f4940' : '#0f172a66',
              borderBottom: '1px solid #1e293b',
            }
          : {}
      }
      className={`relative w-full cursor-pointer select-none touch-pan-y overflow-hidden transition-all ${
        variant === 'desktop'
          ? 'h-20 w-full'
          : 'h-16 rounded-2xl border-2'
      }`}
      title={`Seek to ${formatTime(currentTime)}`}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
      {labelOverlay && variant === 'deck' && (
        <div className="pointer-events-none absolute left-3 top-1.5 flex items-center gap-1.5">
          <span className="text-[11px] font-semibold tracking-tight text-slate-100/90">
            {labelOverlay}
          </span>
        </div>
      )}
    </div>
  );
};
