import React from 'react';
import { useAudioStore } from './useAudioStore';
import { Card } from '@/design-system/Card';
import { Button } from '@/design-system/Button';
import { Badge } from '@/design-system/Badge';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import { WaveformCanvas } from '@/components/WaveformCanvas';
import './WaveformComparisonPanel.css';

export const WaveformComparisonPanel: React.FC = () => {
  const {
    originalBuffer,
    renderedProceduralBuffer,
    recipe,
    comparisonMetrics,
    isPlaying,
    activePlaybackSource,
    currentTime,
    playOriginal,
    playProcedural,
    stopPlayback,
    toggleABPlayback,
    seek,
    zoom,
    setZoom,
  } = useAudioStore();

  const isPlayingOriginal = isPlaying && activePlaybackSource === 'original';
  const isPlayingProcedural = isPlaying && activePlaybackSource === 'procedural';

  const sharedTimelineDuration = Math.max(
    0.1,
    Math.max(originalBuffer?.duration || 0, renderedProceduralBuffer?.duration || recipe.duration)
  );

  return (
    <Card
      title="3. Comparison & Approximation"
      subtitle="Real decoded waveform alignment and multi-feature approximation score"
      className="waveform-comparison-panel"
      actions={
        <div className="zoom-controls">
          <span className="zoom-label">Zoom:</span>
          <Button
            variant={zoom === 1 ? 'active' : 'secondary'}
            size="xs"
            onClick={() => setZoom(1)}
            title="Fit to width (1x)"
          >
            1x
          </Button>
          <Button
            variant={zoom === 2 ? 'active' : 'secondary'}
            size="xs"
            onClick={() => setZoom(2)}
            title="Zoom 2x"
          >
            2x
          </Button>
          <Button
            variant={zoom === 4 ? 'active' : 'secondary'}
            size="xs"
            onClick={() => setZoom(4)}
            title="Zoom 4x"
          >
            4x
          </Button>
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
              onClick={isPlayingOriginal ? stopPlayback : playOriginal}
              title="Play original decoded audio"
            >
              <AcornIcon name={isPlayingOriginal ? 'stop' : 'play'} size={14} />
              Original
            </Button>

            <Button
              variant={isPlayingProcedural ? 'active' : 'primary'}
              size="sm"
              onClick={isPlayingProcedural ? stopPlayback : playProcedural}
              title="Play procedural synthesized audio"
            >
              <AcornIcon name={isPlayingProcedural ? 'stop' : 'play'} size={14} />
              Procedural
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={toggleABPlayback}
              title="Instantaneous A/B playback swap"
            >
              <AcornIcon name="sliders" size={14} />
              A/B Swap ({activePlaybackSource ? activePlaybackSource.toUpperCase() : 'STOPPED'})
            </Button>
          </div>

          <div className="cursor-time">
            <span>Cursor: </span>
            <code>
              {currentTime.toFixed(3)}s / {sharedTimelineDuration.toFixed(3)}s
            </code>
          </div>
        </div>

        {/* Dual Synchronized Real Waveforms */}
        <div className="waveforms-stack">
          {/* Original Waveform */}
          <div className="waveform-slot">
            <div className="waveform-slot__header">
              <span className="waveform-slot__title">Original Decoded Audio</span>
              {originalBuffer ? (
                <span className="waveform-slot__info">
                  {originalBuffer.duration.toFixed(3)}s · {originalBuffer.sampleRate}Hz
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
              height={70}
              color="var(--color-waveform-original)"
              ariaLabel="Original Decoded Audio Waveform"
            />
          </div>

          {/* Procedural Waveform */}
          <div className="waveform-slot">
            <div className="waveform-slot__header">
              <span className="waveform-slot__title">Procedural Synthesized Audio</span>
              <span className="waveform-slot__info">
                {recipe.duration.toFixed(3)}s · {recipe.layers.length} layers
              </span>
            </div>
            <WaveformCanvas
              audioBuffer={renderedProceduralBuffer}
              currentTime={currentTime}
              duration={sharedTimelineDuration}
              onSeek={seek}
              zoom={zoom}
              height={70}
              color="var(--color-waveform-procedural)"
              ariaLabel="Procedural Synthesized Audio Waveform"
            />
          </div>
        </div>

        {/* Approximation Score Card */}
        <div className="approximation-card">
          <div className="approximation-card__top">
            <div className="score-badge-group">
              <span className="score-title">Approximation Score</span>
              <span className="score-number">
                {comparisonMetrics ? `${comparisonMetrics.approximationScore}%` : 'N/A'}
              </span>
              {comparisonMetrics && (
                <Badge
                  variant={
                    comparisonMetrics.approximationScore >= 75
                      ? 'success'
                      : comparisonMetrics.approximationScore >= 50
                        ? 'accent'
                        : 'warning'
                  }
                >
                  {comparisonMetrics.label}
                </Badge>
              )}
            </div>

            <p className="score-disclaimer">
              Calculated from normalized envelope alignment, spectral centroid brightness, and
              zero-crossing distributions. This is an algorithmic approximation score, not a
              subjective audio quality score.
            </p>
          </div>

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
                <span className="submetric-name">Spectral Brightness Match</span>
                <div className="submetric-bar-wrap">
                  <div
                    className="submetric-bar"
                    style={{ width: `${comparisonMetrics.spectralSimilarity}%` }}
                  />
                </div>
                <span className="submetric-num">{comparisonMetrics.spectralSimilarity}%</span>
              </div>

              <div className="score-submetric">
                <span className="submetric-name">Timbre & Noise Ratio</span>
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
