import React, { useRef, useEffect, useCallback } from 'react';
import { SpectrumData } from '@/types/mathModel';
import { useAudioStore } from '@/features/editor/useAudioStore';

export interface SpectrumCanvasProps {
  spectrum: SpectrumData | null;
  height?: number;
}

/**
 * Renders overlaid averaged FFT magnitude spectra (dB vs log-frequency)
 * for Original and Reconstructed signals.
 */
export const SpectrumCanvas: React.FC<SpectrumCanvasProps> = ({ spectrum, height = 140 }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useAudioStore((s) => s.theme);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (w === 0 || h === 0) return;

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.scale(dpr, dpr);

    const isDark = theme === 'dark' || document.documentElement.getAttribute('data-theme') === 'dark';
    const computed = getComputedStyle(canvas);
    const bg = computed.getPropertyValue('--color-waveform-bg').trim() || (isDark ? '#23222b' : '#f7f6fb');
    const grid = computed.getPropertyValue('--color-border-subtle').trim() || (isDark ? '#383441' : '#e3e2e7');
    const textMuted = computed.getPropertyValue('--color-text-muted').trim() || (isDark ? '#8f8f9d' : '#73737c');
    const origColor = computed.getPropertyValue('--color-waveform-original').trim() || (isDark ? '#7bb2ff' : '#0060df');
    const reconColor = computed.getPropertyValue('--color-waveform-procedural').trim() || (isDark ? '#4cc4e1' : '#10a4ca');

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    if (!spectrum || spectrum.frequencies.length < 2) {
      ctx.fillStyle = textMuted;
      ctx.font = '11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Convert audio to compare frequency spectra', w / 2, h / 2);
      return;
    }

    const padL = 32;
    const padR = 8;
    const padT = 14;
    const padB = 18;
    const plotW = Math.max(10, w - padL - padR);
    const plotH = Math.max(10, h - padT - padB);

    const minFreq = 20;
    const maxFreq = Math.max(1000, spectrum.frequencies[spectrum.frequencies.length - 1] ?? 22050);
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);

    const freqToX = (f: number) => {
      const clamped = Math.max(minFreq, Math.min(maxFreq, f));
      return padL + ((Math.log10(clamped) - logMin) / (logMax - logMin)) * plotW;
    };
    const dbToY = (db: number) => {
      const clamped = Math.max(-100, Math.min(0, db));
      return padT + ((0 - clamped) / 100) * plotH;
    };

    // Gridlines (dB & Hz)
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.fillStyle = textMuted;
    ctx.font = '9px monospace';

    for (const db of [0, -25, -50, -75, -100]) {
      const y = dbToY(db);
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${db}`, padL - 4, y);
    }

    const tickFreqs = [50, 100, 250, 500, 1000, 2000, 5000, 10000, 20000].filter((f) => f <= maxFreq);
    for (const f of tickFreqs) {
      const x = freqToX(f);
      ctx.beginPath();
      ctx.moveTo(x, padT);
      ctx.lineTo(x, padT + plotH);
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, x, padT + plotH + 3);
    }

    const drawCurve = (vals: Float32Array, stroke: string, dashed = false) => {
      ctx.save();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = dashed ? 1.5 : 1.75;
      if (dashed) ctx.setLineDash([4, 2]);
      ctx.beginPath();
      let started = false;
      for (let i = 1; i < spectrum.frequencies.length; i++) {
        const f = spectrum.frequencies[i]!;
        if (f < minFreq) continue;
        const x = freqToX(f);
        const y = dbToY(vals[i]!);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else {
          ctx.lineTo(x, y);
        }
      }
      ctx.stroke();
      ctx.restore();
    };

    drawCurve(spectrum.originalDb, origColor, false);
    drawCurve(spectrum.reconstructedDb, reconColor, true);

    // Legend
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = origColor;
    ctx.fillText('— Original', padL + 4, 2);
    ctx.fillStyle = reconColor;
    ctx.fillText('-- Reconstructed', padL + 74, 2);
  }, [spectrum, theme]);

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
      <canvas
        ref={canvasRef}
        className="acorn-waveform-canvas"
        style={{ height }}
        aria-label="Frequency Spectrum Comparison (dB vs Hz)"
      />
    </div>
  );
};
