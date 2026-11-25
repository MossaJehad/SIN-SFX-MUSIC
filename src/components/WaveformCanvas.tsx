import React, { useRef, useEffect, useCallback, useMemo } from 'react';
import { useAudioStore } from '@/features/editor/useAudioStore';
import './WaveformCanvas.css';

export interface WaveformCanvasProps {
  audioBuffer: AudioBuffer | null;
  currentTime?: number;
  duration?: number;
  color?: string;
  cursorColor?: string;
  onSeek?: (timeSeconds: number) => void;
  zoom?: number; // 1 = fit, >1 = zoom in
  height?: number;
  label?: string;
  ariaLabel?: string;
  /** Auto-scale quiet difference/residual waveforms to fill canvas height for visibility */
  autoGain?: boolean;
}

interface MinMaxPeak {
  min: number;
  max: number;
}

function resolveCanvasColor(
  canvas: HTMLCanvasElement | null,
  colorProp: string | undefined,
  cssVarFallback: string,
  hexFallback: string
): string {
  if (!canvas) return hexFallback;
  const computed = getComputedStyle(canvas);
  if (colorProp && colorProp.trim().length > 0) {
    const trimmed = colorProp.trim();
    if (trimmed.startsWith('var(')) {
      const varName = trimmed.replace(/^var\(\s*/, '').replace(/\s*[,)].*$/, '');
      const val = computed.getPropertyValue(varName).trim();
      if (val) return val;
    } else {
      return trimmed;
    }
  }
  const val = computed.getPropertyValue(cssVarFallback).trim();
  return val || hexFallback;
}

export const WaveformCanvas: React.FC<WaveformCanvasProps> = ({
  audioBuffer,
  currentTime = 0,
  duration: explicitDuration,
  color,
  cursorColor,
  onSeek,
  zoom = 1,
  height = 80,
  label,
  ariaLabel,
  autoGain = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useAudioStore((state) => state.theme);

  const duration = explicitDuration ?? audioBuffer?.duration ?? 1;

  // Extract real peaks accurately across the entire AudioBuffer (fixes short-buffer and tail truncation bugs)
  const { peaks, maxAbsPeak } = useMemo<{ peaks: MinMaxPeak[]; maxAbsPeak: number }>(() => {
    if (!audioBuffer || audioBuffer.length === 0) return { peaks: [], maxAbsPeak: 0 };

    const numChannels = audioBuffer.numberOfChannels;
    const totalSamples = audioBuffer.length;
    const binCount = Math.min(800, totalSamples);
    const result: MinMaxPeak[] = new Array(binCount);

    const channels: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }

    let overallMax = 0;
    for (let b = 0; b < binCount; b++) {
      const startIdx = Math.floor((b * totalSamples) / binCount);
      const endIdx = Math.max(startIdx + 1, Math.floor(((b + 1) * totalSamples) / binCount));
      let minVal = 0;
      let maxVal = 0;

      for (let i = startIdx; i < Math.min(totalSamples, endIdx); i++) {
        for (let c = 0; c < numChannels; c++) {
          const val = channels[c]![i]!;
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
          const a = Math.abs(val);
          if (a > overallMax) overallMax = a;
        }
      }
      result[b] = { min: minVal, max: maxVal };
    }

    return { peaks: result, maxAbsPeak: overallMax };
  }, [audioBuffer]);

  const gainFactor = useMemo(() => {
    if (!autoGain || maxAbsPeak <= 1e-12) return 1;
    if (maxAbsPeak < 0.85) return Math.min(100000, 0.9 / maxAbsPeak);
    return 1;
  }, [autoGain, maxAbsPeak]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const h = rect.height;

    if (width === 0 || h === 0) return;

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);

    const isDark = theme === 'dark' || document.documentElement.getAttribute('data-theme') === 'dark';

    const waveColor = resolveCanvasColor(
      canvas,
      color,
      '--color-waveform-original',
      isDark ? '#7bb2ff' : '#0060df'
    );
    const activeCursorColor = resolveCanvasColor(
      canvas,
      cursorColor,
      '--color-waveform-cursor',
      isDark ? '#ff848b' : '#c50042'
    );
    const bgColor = resolveCanvasColor(
      canvas,
      undefined,
      '--color-waveform-bg',
      isDark ? '#23222b' : '#f7f6fb'
    );
    const centerLineColor = resolveCanvasColor(
      canvas,
      undefined,
      '--color-border-subtle',
      isDark ? '#383441' : '#e3e2e7'
    );

    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, h);

    const midY = h / 2;
    ctx.strokeStyle = centerLineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    if (peaks.length === 0) {
      const placeholderColor = resolveCanvasColor(
        canvas,
        undefined,
        '--color-text-muted',
        isDark ? '#8f8f9d' : '#73737c'
      );
      ctx.fillStyle = placeholderColor;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No audio data available', width / 2, midY);
      return;
    }

    // Align buffer duration proportionally to shared timeline duration!
    const bufDuration = audioBuffer?.duration ?? duration;
    const durationRatio = duration > 0 ? Math.min(1, bufDuration / duration) : 1;
    const virtualWidth = width * zoom * durationRatio;
    const step = virtualWidth / peaks.length;

    ctx.fillStyle = waveColor;
    for (let i = 0; i < peaks.length; i++) {
      const x = i * step;
      if (x > width) break;

      const p = peaks[i]!;
      const maxScaled = Math.max(-1, Math.min(1, p.max * gainFactor));
      const minScaled = Math.max(-1, Math.min(1, p.min * gainFactor));
      const yTop = midY - maxScaled * (midY - 4);
      const yBottom = midY - minScaled * (midY - 4);
      const barHeight = Math.max(1.2, yBottom - yTop);

      ctx.fillRect(x, yTop, Math.max(1, step * 0.9), barHeight);
    }

    // Draw Playhead cursor (scaled by zoom)
    if (duration > 0 && currentTime >= 0) {
      const cursorX = Math.min(width, (currentTime / duration) * width * zoom);
      ctx.strokeStyle = activeCursorColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, h);
      ctx.stroke();

      ctx.fillStyle = activeCursorColor;
      ctx.beginPath();
      ctx.moveTo(cursorX - 4, 0);
      ctx.lineTo(cursorX + 4, 0);
      ctx.lineTo(cursorX, 6);
      ctx.closePath();
      ctx.fill();
    }
  }, [peaks, audioBuffer, currentTime, duration, color, cursorColor, zoom, theme, gainFactor]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'attributes' && m.attributeName === 'data-theme') {
          draw();
        }
      }
    });

    if (typeof document !== 'undefined' && document.documentElement) {
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['data-theme'],
      });
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      observer.disconnect();
    };
  }, [draw]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!onSeek || !canvasRef.current || duration <= 0) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const seekTime = (x / (rect.width * zoom)) * duration;
    onSeek(Math.min(duration, seekTime));
  };

  const badgeText =
    label && autoGain && maxAbsPeak > 1e-12 && gainFactor > 1.2
      ? `${label} (×${gainFactor >= 100 ? Math.round(gainFactor) : gainFactor.toFixed(1)}, peak ${maxAbsPeak.toExponential(1)})`
      : label;

  return (
    <div ref={containerRef} className="acorn-waveform-container" style={{ height }}>
      {badgeText && <div className="acorn-waveform-badge">{badgeText}</div>}
      <canvas
        ref={canvasRef}
        className="acorn-waveform-canvas"
        style={{ height }}
        onPointerDown={handlePointerDown}
        role="slider"
        aria-label={ariaLabel || label || 'Audio Waveform'}
        aria-valuemin={0}
        aria-valuemax={Number(duration.toFixed(2))}
        aria-valuenow={Number(currentTime.toFixed(2))}
        tabIndex={0}
        onKeyDown={(e) => {
          if (!onSeek) return;
          if (e.key === 'ArrowRight') onSeek(Math.min(duration, currentTime + 0.05));
          if (e.key === 'ArrowLeft') onSeek(Math.max(0, currentTime - 0.05));
        }}
      />
    </div>
  );
};
