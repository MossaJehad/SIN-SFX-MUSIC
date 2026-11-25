import React, { useRef, useEffect, useCallback } from 'react';
import { SpectrogramData } from '@/types/mathModel';
import { useAudioStore } from '@/features/editor/useAudioStore';

export interface SpectrogramCanvasProps {
  spectrogram: SpectrogramData | null;
  source: 'original' | 'reconstructed' | 'difference';
  label: string;
  height?: number;
}

/**
 * Maps normalized intensity [0..1] to an accessible magma-inspired perceptual color ramp.
 */
function colorRamp(t: number, isDark: boolean): [number, number, number] {
  const v = Math.max(0, Math.min(1, t));
  if (isDark) {
    // Deep indigo -> Firefox blue -> cyan -> bright gold
    const r = Math.round(28 + 227 * Math.pow(v, 1.8));
    const g = Math.round(27 + 205 * Math.pow(v, 1.25));
    const b = Math.round(40 + 185 * Math.sin(v * Math.PI * 0.85));
    return [r, g, b];
  }
  // Light theme: clean soft canvas -> Firefox blue -> deep magenta/crimson
  const r = Math.round(247 - 220 * Math.pow(v, 0.9) + 180 * Math.pow(v, 2.2));
  const g = Math.round(246 - 210 * Math.pow(v, 0.75));
  const b = Math.round(251 - 60 * v - 120 * Math.pow(v, 2.0));
  return [
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, b)),
  ];
}

export const SpectrogramCanvas: React.FC<SpectrogramCanvasProps> = ({
  spectrogram,
  source,
  label,
  height = 84,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useAudioStore((s) => s.theme);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    canvas.width = w;
    canvas.height = h;

    const isDark = theme === 'dark' || document.documentElement.getAttribute('data-theme') === 'dark';

    if (!spectrogram || spectrogram.numFrames === 0 || spectrogram.numBins === 0) {
      ctx.fillStyle = isDark ? '#23222b' : '#f7f6fb';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = isDark ? '#8f8f9d' : '#73737c';
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No spectrogram data', w / 2, h / 2);
      return;
    }

    const { numFrames, numBins, originalDb, reconstructedDb } = spectrogram;
    const img = ctx.createImageData(w, h);
    const pixels = img.data;

    for (let x = 0; x < w; x++) {
      const frame = Math.min(numFrames - 1, Math.floor((x / w) * numFrames));
      const base = frame * numBins;
      for (let y = 0; y < h; y++) {
        // y=0 is high freq, y=h-1 is low freq (sqrt frequency scaling for better musical clarity)
        const normY = 1 - y / Math.max(1, h - 1);
        const bin = Math.min(numBins - 1, Math.floor(normY * normY * (numBins - 1)));
        const idx = base + bin;

        let normVal = 0;
        if (source === 'original') {
          normVal = (originalDb[idx]! + 95) / 95;
        } else if (source === 'reconstructed') {
          normVal = (reconstructedDb[idx]! + 95) / 95;
        } else {
          // Spectral absolute error in dB [0 .. 40 dB]
          normVal = Math.abs(originalDb[idx]! - reconstructedDb[idx]!) / 40;
        }

        const [r, g, b] = colorRamp(normVal, isDark);
        const pIdx = (y * w + x) * 4;
        pixels[pIdx] = r;
        pixels[pIdx + 1] = g;
        pixels[pIdx + 2] = b;
        pixels[pIdx + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);
  }, [spectrogram, source, theme]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const onResize = () => draw();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [draw]);

  return (
    <div className="acorn-waveform-container" style={{ height }}>
      <div className="acorn-waveform-badge">{label}</div>
      <canvas
        ref={canvasRef}
        className="acorn-waveform-canvas"
        style={{ height }}
        aria-label={`${label} Spectrogram`}
      />
    </div>
  );
};
