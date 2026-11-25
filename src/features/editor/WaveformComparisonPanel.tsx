import React, { useState } from 'react';
import { useAudioStore } from './useAudioStore';
import { Card } from '@/design-system/Card';
import { Button } from '@/design-system/Button';
import { Badge } from '@/design-system/Badge';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import { WaveformCanvas } from '@/components/WaveformCanvas';
import { SpectrumCanvas } from '@/components/SpectrumCanvas';
import { SpectrogramCanvas } from '@/components/SpectrogramCanvas';
import './WaveformComparisonPanel.css';

function formatSnr(snrDb: number): string {
  if (!Number.isFinite(snrDb)) {
    return snrDb > 0 ? '> 140 dB (Exact)' : '-∞ dB';
  }
  return `${snrDb.toFixed(1)} dB`;
}

export const WaveformComparisonPanel: React.FC = () => {
  const {
    originalBuffer,
    renderedProceduralBuffer,
    differenceBuffer,
    recipe,
    mathModel,
    reconstructionMetrics,
    comparisonMetrics,
    executionTimings,
    isPlaying,
    activePlaybackSource,
    currentTime,
    playOriginal,
    playProcedural,
    playDifference,
    stopPlayback,
    toggleABPlayback,
    seek,
    zoom,
    setZoom,
  } = useAudioStore();

  const [vizTab, setVizTab] = useState<'waveforms' | 'spectrum' | 'spectrogram'>('waveforms');

  const isPlayingOriginal = isPlaying && activePlaybackSource === 'original';
  const isPlayingRecon = isPlaying && activePlaybackSource === 'procedural';
  const isPlayingDiff = isPlaying && activePlaybackSource === 'difference';

  const sharedTimelineDuration = Math.max(
    0.02,
    Math.max(originalBuffer?.duration || 0, renderedProceduralBuffer?.duration || recipe.duration)
  );

  const reconSubtitle = mathModel
    ? `${mathModel.duration.toFixed(3)}s · ${mathModel.sampleRate}Hz · ${mathModel.mode}`
    : `${recipe.duration.toFixed(3)}s · ${recipe.layers.length} layers`;

  return (
    <Card
      title="3. Audio Comparison & Error Analysis"
      subtitle="Synchronized playback, waveforms, spectrum, spectrogram & real DSP metrics"
      className="waveform-comparison-panel"
      actions={
        <div className="zoom-controls">
          <span className="zoom-label">Zoom:</span>
          {[1, 2, 4].map((z) => (
            <Button
              key={z}
              variant={zoom === z ? 'active' : 'secondary'}
              size="xs"
              onClick={() => setZoom(z)}
              title={`Zoom ${z}x`}
            >
              {z}x
            </Button>
          ))}
        </div>
      }
    >
      <div className="waveform-comparison-panel__inner">
        {/* Playback Control Bar */}
        <div className="comparison-toolbar">
          <div className="playback-buttons">
            <Button
              variant={isPlayingOriginal ? 'active' : 'secondary'}
              size="sm"
              disabled={!originalBuffer}
              onClick={isPlayingOriginal ? () => stopPlayback(true) : () => playOriginal()}
              title="Play original decoded audio"
            >
              <AcornIcon name={isPlayingOriginal ? 'stop' : 'play'} size={14} />
              Original
            </Button>

            <Button
              variant={isPlayingRecon ? 'active' : 'primary'}
              size="sm"
              onClick={isPlayingRecon ? () => stopPlayback(true) : () => playProcedural()}
              title="Play reconstructed mathematical audio"
            >
              <AcornIcon name={isPlayingRecon ? 'stop' : 'play'} size={14} />
              Reconstructed
            </Button>

            <Button
              variant={isPlayingDiff ? 'active' : 'secondary'}
              size="sm"
              disabled={!differenceBuffer}
              onClick={isPlayingDiff ? () => stopPlayback(true) : () => playDifference()}
              title="Play difference signal (Original - Reconstructed)"
            >
              <AcornIcon name={isPlayingDiff ? 'stop' : 'play'} size={14} />
              Diff
            </Button>

            <Button
              variant="secondary"
              size="sm"
              disabled={!originalBuffer}
              onClick={toggleABPlayback}
              title="Instantaneous synchronized A/B playback swap"
            >
              <AcornIcon name="sliders" size={14} />
              A/B ({activePlaybackSource ? activePlaybackSource.toUpperCase() : 'SWAP'})
            </Button>
          </div>

          <div className="cursor-time">
            <span>Cursor: </span>
            <code>
              {currentTime.toFixed(3)}s / {sharedTimelineDuration.toFixed(3)}s
            </code>
          </div>
        </div>

        {/* Visualization Mode Switcher */}
        <div className="viz-tabs-bar" role="tablist" aria-label="Comparison visualizations">
          <button
            type="button"
            role="tab"
            aria-selected={vizTab === 'waveforms'}
            className={`viz-tab-btn ${vizTab === 'waveforms' ? 'active' : ''}`}
            onClick={() => setVizTab('waveforms')}
          >
            Waveforms &amp; Difference
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={vizTab === 'spectrum'}
            className={`viz-tab-btn ${vizTab === 'spectrum' ? 'active' : ''}`}
            onClick={() => setVizTab('spectrum')}
          >
            Frequency Spectrum
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={vizTab === 'spectrogram'}
            className={`viz-tab-btn ${vizTab === 'spectrogram' ? 'active' : ''}`}
            onClick={() => setVizTab('spectrogram')}
          >
            Spectrogram
          </button>
        </div>

        {/* View 1: Waveforms + Difference */}
        {vizTab === 'waveforms' && (
          <div className="waveforms-stack">
            <div className="waveform-slot">
              <div className="waveform-slot__header">
                <span className="waveform-slot__title">Original Decoded Audio</span>
                {originalBuffer ? (
                  <span className="waveform-slot__info">
                    {originalBuffer.duration.toFixed(3)}s · {originalBuffer.sampleRate}Hz ·{' '}
                    {originalBuffer.numberOfChannels}ch
                  </span>
                ) : (
                  <span className="waveform-slot__info text-muted">Upload audio to compare</span>
                )}
              </div>
              <WaveformCanvas
                audioBuffer={originalBuffer}
                currentTime={currentTime}
                duration={sharedTimelineDuration}
                onSeek={seek}
                zoom={zoom}
                height={62}
                color="var(--color-waveform-original)"
                ariaLabel="Original Decoded Audio Waveform"
              />
            </div>

            <div className="waveform-slot">
              <div className="waveform-slot__header">
                <span className="waveform-slot__title">Reconstructed Mathematical Audio</span>
                <span className="waveform-slot__info">{reconSubtitle}</span>
              </div>
              <WaveformCanvas
                audioBuffer={renderedProceduralBuffer}
                currentTime={currentTime}
                duration={sharedTimelineDuration}
                onSeek={seek}
                zoom={zoom}
                height={62}
                color="var(--color-waveform-procedural)"
                ariaLabel="Reconstructed Mathematical Audio Waveform"
              />
            </div>

            <div className="waveform-slot">
              <div className="waveform-slot__header">
                <span className="waveform-slot__title">Difference Waveform (Original − Reconstructed)</span>
                <span className="waveform-slot__info">
                  {reconstructionMetrics
                    ? `Peak err: ${reconstructionMetrics.peakAbsoluteError.toExponential(2)}`
                    : 'Run conversion to measure error'}
                </span>
              </div>
              <WaveformCanvas
                audioBuffer={differenceBuffer}
                currentTime={currentTime}
                duration={sharedTimelineDuration}
                onSeek={seek}
                zoom={zoom}
                height={52}
                color="var(--color-critical)"
                label="Residual"
                autoGain
                ariaLabel="Difference Waveform"
              />
            </div>
          </div>
        )}

        {/* View 2: Frequency Spectrum */}
        {vizTab === 'spectrum' && (
          <div className="waveforms-stack">
            <div className="waveform-slot__header">
              <span className="waveform-slot__title">Averaged Magnitude Spectrum (dB vs Log Hz)</span>
              <span className="waveform-slot__info">
                {reconstructionMetrics
                  ? `LSD: ${reconstructionMetrics.logSpectralDistanceDb.toFixed(2)} dB`
                  : 'N/A'}
              </span>
            </div>
            <SpectrumCanvas spectrum={reconstructionMetrics?.spectrum ?? null} height={175} />
          </div>
        )}

        {/* View 3: Spectrograms */}
        {vizTab === 'spectrogram' && (
          <div className="waveforms-stack">
            <SpectrogramCanvas
              spectrogram={reconstructionMetrics?.spectrogram ?? null}
              source="original"
              label="Original Spectrogram"
              height={66}
            />
            <SpectrogramCanvas
              spectrogram={reconstructionMetrics?.spectrogram ?? null}
              source="reconstructed"
              label="Reconstructed Spectrogram"
              height={66}
            />
            <SpectrogramCanvas
              spectrogram={reconstructionMetrics?.spectrogram ?? null}
              source="difference"
              label="Spectral Error (|ΔdB|)"
              height={54}
            />
          </div>
        )}

        {/* Real Measured DSP Metrics Card */}
        <div className="approximation-card">
          <div className="approximation-card__top">
            <div className="score-badge-group">
              <span className="score-title">Measured SNR</span>
              <span className="score-number">
                {reconstructionMetrics
                  ? formatSnr(reconstructionMetrics.snrDb)
                  : comparisonMetrics
                    ? `${comparisonMetrics.approximationScore}%`
                    : 'N/A'}
              </span>
              {(reconstructionMetrics || comparisonMetrics) && (
                <Badge
                  variant={
                    (reconstructionMetrics?.snrDb ?? 0) >= 25
                      ? 'success'
                      : (reconstructionMetrics?.snrDb ?? 0) >= 10
                        ? 'accent'
                        : 'warning'
                  }
                >
                  {reconstructionMetrics?.label ?? comparisonMetrics?.label}
                </Badge>
              )}
            </div>

            <p className="score-disclaimer">
              All metrics below are computed directly from decoded PCM samples vs exclusively
              reconstructed samples (zero fabricated perceptual accuracy percentages).
            </p>
          </div>

          {reconstructionMetrics && (
            <div className="dsp-metrics-grid">
              <div className="dsp-metric-cell">
                <span className="dsp-metric-label">RMSE</span>
                <span className="dsp-metric-val">
                  {reconstructionMetrics.rmse < 0.001
                    ? reconstructionMetrics.rmse.toExponential(2)
                    : reconstructionMetrics.rmse.toFixed(5)}
                </span>
              </div>
              <div className="dsp-metric-cell">
                <span className="dsp-metric-label">Log-Spectral Dist.</span>
                <span className="dsp-metric-val">
                  {reconstructionMetrics.logSpectralDistanceDb.toFixed(2)} dB
                </span>
              </div>
              <div className="dsp-metric-cell">
                <span className="dsp-metric-label">Envelope Corr. (r)</span>
                <span className="dsp-metric-val">
                  {reconstructionMetrics.envelopeCorrelation.toFixed(4)}
                </span>
              </div>
              <div className="dsp-metric-cell">
                <span className="dsp-metric-label">Rel. L2 Error</span>
                <span className="dsp-metric-val">
                  {Number.isFinite(reconstructionMetrics.relativeL2Error)
                    ? `${(reconstructionMetrics.relativeL2Error * 100).toFixed(2)}%`
                    : '∞'}
                </span>
              </div>
              <div className="dsp-metric-cell">
                <span className="dsp-metric-label">Recon Time</span>
                <span className="dsp-metric-val">
                  {executionTimings ? `${executionTimings.totalMs.toFixed(1)} ms` : '—'}
                </span>
              </div>
              <div className="dsp-metric-cell">
                <span className="dsp-metric-label">Peak / Clipping</span>
                <span className="dsp-metric-val">
                  {reconstructionMetrics.reconstructedPeak.toFixed(3)} /{' '}
                  {reconstructionMetrics.clippedSamples === 0
                    ? 'Clean'
                    : `${reconstructionMetrics.clippedSamples} clip`}
                </span>
              </div>
            </div>
          )}

          {comparisonMetrics && (
            <div className="score-breakdown-grid">
              <div className="score-submetric">
                <span className="submetric-name">Envelope Contour Match</span>
                <div className="submetric-bar-wrap">
                  <div
                    className="submetric-bar"
                    style={{ width: `${comparisonMetrics.envelopeSimilarity}%` }}
                  />
                </div>
                <span className="submetric-num">{comparisonMetrics.envelopeSimilarity}%</span>
              </div>

              <div className="score-submetric">
                <span className="submetric-name">Spectral Fidelity (LSD)</span>
                <div className="submetric-bar-wrap">
                  <div
                    className="submetric-bar"
                    style={{ width: `${comparisonMetrics.spectralSimilarity}%` }}
                  />
                </div>
                <span className="submetric-num">{comparisonMetrics.spectralSimilarity}%</span>
              </div>

              <div className="score-submetric">
                <span className="submetric-name">Waveform SNR Index</span>
                <div className="submetric-bar-wrap">
                  <div
                    className="submetric-bar"
                    style={{ width: `${comparisonMetrics.timbreSimilarity}%` }}
                  />
                </div>
                <span className="submetric-num">{comparisonMetrics.timbreSimilarity}%</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
