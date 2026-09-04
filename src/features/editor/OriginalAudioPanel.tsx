import React, { useRef } from 'react';
import { useAudioStore } from './useAudioStore';
import { Card } from '@/design-system/Card';
import { Button } from '@/design-system/Button';
import { Badge } from '@/design-system/Badge';
import { ProgressBar } from '@/design-system/ProgressBar';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import { WaveformCanvas } from '@/components/WaveformCanvas';
import { formatBytes } from '@/audio/export/sizeCalculator';
import './OriginalAudioPanel.css';

export const OriginalAudioPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    originalFileName,
    originalSizeBytes,
    originalBuffer,
    originalAnalysis,
    isOriginalLoading,
    originalError,
    loadAudioFromFile,
    clearOriginalAudio,
    generateProceduralApproximation,
    cancelConversion,
    isConverting,
    conversionProgress,
    conversionStatusMessage,
    isPlaying,
    activePlaybackSource,
    currentTime,
    playOriginal,
    stopPlayback,
    seek,
    preset,
  } = useAudioStore();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await loadAudioFromFile(file);
      e.target.value = '';
    }
  };

  const isPlayingThis = isPlaying && activePlaybackSource === 'original';

  const classificationVariantMap: Record<string, 'default' | 'accent' | 'success' | 'warning'> = {
    tonal: 'accent',
    percussive: 'warning',
    noisy: 'default',
    mixed: 'success',
  };

  return (
    <Card
      title="1. Original Audio"
      subtitle="Source sound effect for DSP analysis"
      actions={
        originalBuffer && (
          <Button
            variant="ghost"
            size="xs"
            onClick={clearOriginalAudio}
            title="Remove uploaded audio"
          >
            <AcornIcon name="close" size={12} />
            Remove
          </Button>
        )
      }
      className="original-audio-panel"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/wav,audio/mpeg,audio/ogg,audio/webm,audio/*,.wav,.mp3,.ogg,.webm"
        className="visually-hidden"
        onChange={handleFileChange}
      />

      {/* Error Message */}
      {originalError && (
        <div className="original-audio-panel__error" role="alert">
          <AcornIcon name="warning" size={16} className="original-audio-panel__error-icon" />
          <div className="original-audio-panel__error-text">{originalError}</div>
        </div>
      )}

      {/* Empty / Upload State */}
      {!originalBuffer && !isOriginalLoading && (
        <div
          className="original-audio-panel__dropzone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) await loadAudioFromFile(file);
          }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              fileInputRef.current?.click();
            }
          }}
        >
          <AcornIcon name="upload" size={28} className="original-audio-panel__upload-icon" />
          <p className="original-audio-panel__dropzone-prompt">
            <strong>Choose an audio file</strong> or drag and drop here
          </p>
          <span className="original-audio-panel__dropzone-hint">
            WAV, MP3, OGG up to 3.0 seconds (Max 10 MB).
          </span>
          <span className="original-audio-panel__dropzone-privacy">
            Processed 100% locally in your browser.
          </span>
        </div>
      )}

      {/* Loading State */}
      {isOriginalLoading && (
        <div className="original-audio-panel__loading">
          <div className="original-audio-panel__spinner" aria-hidden="true" />
          <p>Decoding and analyzing audio in browser...</p>
        </div>
      )}

      {/* Loaded Audio Content */}
      {originalBuffer && !isOriginalLoading && (
        <div className="original-audio-panel__content">
          {/* Metadata Bar */}
          <div className="original-audio-panel__meta-grid">
            <div className="meta-item">
              <span className="meta-label">File:</span>
              <span className="meta-val filename" title={originalFileName || ''}>
                {originalFileName}
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Duration:</span>
              <span className="meta-val">{originalBuffer.duration.toFixed(3)}s</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Size:</span>
              <span className="meta-val">{formatBytes(originalSizeBytes)}</span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Rate / Ch:</span>
              <span className="meta-val">
                {originalBuffer.sampleRate} Hz ·{' '}
                {originalBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}
              </span>
            </div>
          </div>

          {/* Waveform Player */}
          <div className="original-audio-panel__player-section">
            <div className="player-controls">
              <Button
                variant={isPlayingThis ? 'active' : 'primary'}
                size="sm"
                onClick={isPlayingThis ? stopPlayback : playOriginal}
                aria-label={isPlayingThis ? 'Stop original audio' : 'Play original audio'}
              >
                <AcornIcon name={isPlayingThis ? 'stop' : 'play'} size={14} />
                {isPlayingThis ? 'Stop' : 'Play Original'}
              </Button>
              <span className="time-display">
                {isPlayingThis ? currentTime.toFixed(2) : '0.00'}s /{' '}
                {originalBuffer.duration.toFixed(2)}s
              </span>
            </div>

            <WaveformCanvas
              audioBuffer={originalBuffer}
              currentTime={isPlayingThis ? currentTime : 0}
              duration={originalBuffer.duration}
              onSeek={seek}
              height={70}
              label="Original Input"
            />
          </div>

          {/* DSP Analysis Metrics */}
          {originalAnalysis && (
            <div className="original-audio-panel__analysis">
              <div className="analysis-header">
                <span className="analysis-title">DSP Analysis</span>
                <Badge
                  variant={classificationVariantMap[originalAnalysis.classification] || 'default'}
                >
                  {originalAnalysis.classification}
                </Badge>
              </div>

              <div className="analysis-grid">
                <div className="metric-box">
                  <span className="metric-label">Peak / RMS</span>
                  <span className="metric-val">
                    {(originalAnalysis.peakAmplitude * 100).toFixed(0)}% /{' '}
                    {(originalAnalysis.rmsLoudness * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Centroid</span>
                  <span className="metric-val">
                    {Math.round(originalAnalysis.averageSpectralCentroid)} Hz
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Tonal Ratio</span>
                  <span className="metric-val">
                    {(originalAnalysis.tonalVsNoisyScore * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Attack / Decay</span>
                  <span className="metric-val">
                    {(originalAnalysis.attackDuration * 1000).toFixed(0)}ms /{' '}
                    {(originalAnalysis.decayDuration * 1000).toFixed(0)}ms
                  </span>
                </div>
              </div>

              <p className="analysis-rationale">
                {originalAnalysis.explanations.classificationRationale}
              </p>
            </div>
          )}

          {/* Conversion Action */}
          <div className="original-audio-panel__convert-box">
            {isConverting ? (
              <div className="convert-progress-wrapper">
                <ProgressBar progress={conversionProgress} label={conversionStatusMessage} />
                <Button variant="destructive" size="xs" onClick={cancelConversion}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                size="md"
                onClick={generateProceduralApproximation}
                className="convert-button"
              >
                <AcornIcon name="sparkle" size={16} />
                Generate Procedural Version ({preset.toUpperCase()})
              </Button>
            )}
            <p className="convert-disclaimer">
              Deterministic approximation using oscillators, noise, envelopes, and filters. Not
              lossless compression.
            </p>
          </div>
        </div>
      )}
    </Card>
  );
};
