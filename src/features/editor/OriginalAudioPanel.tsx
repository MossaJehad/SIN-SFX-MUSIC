import React, { useRef } from 'react';
import { useAudioStore } from './useAudioStore';
import { Card } from '@/design-system/Card';
import { Button } from '@/design-system/Button';
import { Badge } from '@/design-system/Badge';
import { ProgressBar } from '@/design-system/ProgressBar';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import { WaveformCanvas } from '@/components/WaveformCanvas';
import { formatBytes } from '@/audio/export/sizeCalculator';
import { ReconstructionMode } from '@/types/mathModel';
import './OriginalAudioPanel.css';

export const OriginalAudioPanel: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    originalFileName,
    originalSizeBytes,
    originalBuffer,
    originalAnalysis,
    originalWarning,
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
    reconstructionConfig,
    setReconstructionMode,
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
    silent: 'default',
  };

  const modes: { id: ReconstructionMode; label: string; hint: string }[] = [
    { id: 'exact', label: 'Exact', hint: 'Numerical baseline (larger)' },
    { id: 'optimized', label: 'Optimized', hint: 'Sinusoidal / STFT balance' },
    { id: 'procedural', label: 'Procedural', hint: 'Compact analytical approx.' },
  ];

  return (
    <Card
      title="1. Upload & Analyze"
      subtitle="Decode PCM and extract spectral features"
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
        accept="audio/wav,audio/mpeg,audio/ogg,audio/webm,audio/flac,audio/*,.wav,.mp3,.ogg,.webm,.flac,.m4a"
        className="visually-hidden"
        onChange={handleFileChange}
      />

      {originalError && (
        <div className="original-audio-panel__error" role="alert">
          <AcornIcon name="warning" size={16} className="original-audio-panel__error-icon" />
          <div className="original-audio-panel__error-text">{originalError}</div>
        </div>
      )}

      {originalWarning && (
        <div className="original-audio-panel__warning" role="status">
          <AcornIcon name="info" size={14} className="original-audio-panel__error-icon" />
          <div>{originalWarning}</div>
        </div>
      )}

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
            WAV, MP3, OGG, WebM, FLAC up to 15.0s (Max 25 MB).
          </span>
          <span className="original-audio-panel__dropzone-privacy">
            Processed 100% locally in your browser.
          </span>
        </div>
      )}

      {isOriginalLoading && (
        <div className="original-audio-panel__loading">
          <div className="original-audio-panel__spinner" aria-hidden="true" />
          <p>Decoding PCM & running spectral analysis...</p>
        </div>
      )}

      {originalBuffer && !isOriginalLoading && (
        <div className="original-audio-panel__content">
          <div className="original-audio-panel__meta-grid">
            <div className="meta-item meta-item--file">
              <span className="meta-label">File:</span>
              <span className="meta-val filename" title={originalFileName || ''}>
                {originalFileName}
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Duration:</span>
              <span className="meta-val" title={`${originalBuffer.duration.toFixed(4)} seconds`}>
                {originalBuffer.duration.toFixed(3)}s
              </span>
            </div>
            <div className="meta-item">
              <span className="meta-label">Size:</span>
              <span className="meta-val" title={`${originalSizeBytes} bytes`}>
                {formatBytes(originalSizeBytes)}
              </span>
            </div>
            <div className="meta-item meta-item--rate">
              <span className="meta-label">Rate / Ch:</span>
              <span
                className="meta-val"
                title={`${originalBuffer.sampleRate} Hz · ${originalBuffer.numberOfChannels === 1 ? 'Mono' : `${originalBuffer.numberOfChannels}ch Stereo`} · ${originalBuffer.length.toLocaleString()} samples`}
              >
                {originalBuffer.sampleRate >= 1000
                  ? `${(originalBuffer.sampleRate / 1000).toFixed(1)} kHz`
                  : `${originalBuffer.sampleRate} Hz`}{' '}
                · {originalBuffer.numberOfChannels === 1 ? 'Mono' : 'Stereo'}
              </span>
            </div>
          </div>

          <div className="original-audio-panel__player-section">
            <div className="player-controls">
              <Button
                variant={isPlayingThis ? 'active' : 'primary'}
                size="sm"
                onClick={isPlayingThis ? () => stopPlayback(true) : () => playOriginal()}
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
              label="Original PCM"
            />
          </div>

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
                    {originalAnalysis.peakAmplitude.toFixed(3)} /{' '}
                    {originalAnalysis.rmsLoudness.toFixed(3)}
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Centroid</span>
                  <span className="metric-val">
                    {Math.round(originalAnalysis.averageSpectralCentroid)} Hz
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Dominant Pitch</span>
                  <span className="metric-val">
                    {originalAnalysis.isSilent
                      ? 'Silent'
                      : Math.abs(
                            originalAnalysis.endFrequencyEstimate -
                              originalAnalysis.startFrequencyEstimate
                          ) > 40
                        ? `${Math.round(originalAnalysis.startFrequencyEstimate)}→${Math.round(originalAnalysis.endFrequencyEstimate)} Hz`
                        : `${originalAnalysis.startFrequencyEstimate.toFixed(1)} Hz`}
                  </span>
                </div>
                <div className="metric-box">
                  <span className="metric-label">Attack / Decay</span>
                  <span className="metric-val">
                    {(originalAnalysis.attackDuration * 1000).toFixed(1)}ms /{' '}
                    {(originalAnalysis.decayDuration * 1000).toFixed(0)}ms
                  </span>
                </div>
              </div>

              <p className="analysis-rationale">
                {originalAnalysis.explanations.classificationRationale}
              </p>
            </div>
          )}

          {/* Reconstruction Mode Quick Selector & Convert Trigger */}
          <div className="original-audio-panel__convert-box">
            <div className="mode-quick-switcher" role="group" aria-label="Reconstruction mode">
              {modes.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`mode-pill ${reconstructionConfig.mode === m.id ? 'mode-pill--active' : ''}`}
                  onClick={() => setReconstructionMode(m.id)}
                  title={m.hint}
                  aria-pressed={reconstructionConfig.mode === m.id}
                >
                  {m.label}
                </button>
              ))}
            </div>

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
                Convert to Math ({reconstructionConfig.mode.toUpperCase()})
              </Button>
            )}
            <p className="convert-disclaimer">
              {reconstructionConfig.mode === 'exact'
                ? 'Exact Fourier STFT baseline: numerical precision, typically larger than original audio.'
                : reconstructionConfig.mode === 'optimized'
                  ? 'Optimized sinusoidal/STFT resynthesis balancing fidelity, timing, and size.'
                  : 'Procedural analytical approximation: smallest code size, approximate timbre.'}
            </p>
          </div>
        </div>
      )}
    </Card>
  );
};
