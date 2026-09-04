import React, { useRef, useEffect, useCallback, useMemo } from 'react';
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

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);

    // Read colors from CSS custom properties if not explicitly provided
    const computedStyle = getComputedStyle(canvas);
    const waveColor =
      color || computedStyle.getPropertyValue('--color-waveform-original').trim() || '#0060df';
    const activeCursorColor =
      cursorColor || computedStyle.getPropertyValue('--color-waveform-cursor').trim() || '#c50042';
    const bgColor = computedStyle.getPropertyValue('--color-waveform-bg').trim() || 'transparent';
    const centerLineColor =
      computedStyle.getPropertyValue('--color-border-subtle').trim() || '#d6d5da';

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
      ctx.fillStyle = computedStyle.getPropertyValue('--color-text-muted').trim() || '#73737c';
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
  }, [peaks, currentTime, duration, color, cursorColor, zoom]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const handleResize = () => draw();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
