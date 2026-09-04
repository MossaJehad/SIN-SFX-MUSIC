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
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const theme = useAudioStore((state) => state.theme);

  const duration = explicitDuration ?? audioBuffer?.duration ?? 1;

  // Extract real peaks from decoded AudioBuffer
  const peaks = useMemo<MinMaxPeak[]>(() => {
    if (!audioBuffer) return [];

    const numChannels = audioBuffer.numberOfChannels;
    const totalSamples = audioBuffer.length;
    // Resolution: 800 peak bins for smooth rendering
    const binCount = 800;
    const samplesPerBin = Math.max(1, Math.floor(totalSamples / binCount));
    const result: MinMaxPeak[] = new Array(binCount);

    const channels: Float32Array[] = [];
    for (let c = 0; c < numChannels; c++) {
      channels.push(audioBuffer.getChannelData(c));
    }

    for (let b = 0; b < binCount; b++) {
      let minVal = 0;
      let maxVal = 0;
      const startIdx = b * samplesPerBin;
      const endIdx = Math.min(totalSamples, startIdx + samplesPerBin);

      for (let i = startIdx; i < endIdx; i++) {
        for (let c = 0; c < numChannels; c++) {
          const val = channels[c]![i]!;
          if (val < minVal) minVal = val;
          if (val > maxVal) maxVal = val;
        }
      }
      result[b] = { min: minVal, max: maxVal };
    }

    return result;
  }, [audioBuffer]);

  // Draw real waveform on HTML5 Canvas
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

    // Resolve colors dynamically from computed styles and current theme
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

    // Clear background
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, h);

    // Center baseline
    const midY = h / 2;
    ctx.strokeStyle = centerLineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(width, midY);
    ctx.stroke();

    if (peaks.length === 0) {
      // Empty waveform placeholder
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

    // Draw waveform peaks
    const virtualWidth = width * zoom;
    const step = virtualWidth / peaks.length;

    ctx.fillStyle = waveColor;
    for (let i = 0; i < peaks.length; i++) {
      const x = i * step;
      if (x > width) break;

      const p = peaks[i]!;
      // Scale to height
      const yTop = midY - p.max * (midY - 4);
      const yBottom = midY - p.min * (midY - 4);
      const barHeight = Math.max(1.5, yBottom - yTop);

      ctx.fillRect(x, yTop, Math.max(1, step * 0.9), barHeight);
    }

    // Draw Playhead cursor
    if (duration > 0 && currentTime >= 0) {
      const cursorX = Math.min(width, (currentTime / duration) * width);
      ctx.strokeStyle = activeCursorColor;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cursorX, 0);
      ctx.lineTo(cursorX, h);
      ctx.stroke();

      // Little playhead triangle cap
      ctx.fillStyle = activeCursorColor;
      ctx.beginPath();
      ctx.moveTo(cursorX - 4, 0);
      ctx.lineTo(cursorX + 4, 0);
      ctx.lineTo(cursorX, 6);
      ctx.closePath();
      ctx.fill();
    }
  }, [peaks, currentTime, duration, color, cursorColor, zoom, theme]);

  // Redraw when draw dependencies (including theme) change
  useEffect(() => {
    draw();
  }, [draw]);

  // Watch for window resize and DOM theme changes
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
    const seekTime = (x / rect.width) * duration;
    onSeek(seekTime);
  };

  return (
    <div ref={containerRef} className="acorn-waveform-container" style={{ height }}>
      {label && <div className="acorn-waveform-badge">{label}</div>}
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
