import React, { useMemo, useState } from 'react';
import { useAudioStore } from './useAudioStore';
import { Card } from '@/design-system/Card';
import { Button } from '@/design-system/Button';
import { Badge } from '@/design-system/Badge';
import { Select } from '@/design-system/Select';
import { SliderWithInput } from '@/design-system/SliderWithInput';
import { Tabs } from '@/design-system/Tabs';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import { LayerList } from './LayerList';
import { LayerEditor } from './LayerEditor';
import { formatMathEquationSummary } from '@/audio/math/mathPipeline';
import {
  OptimizedMethod,
  OutputSampleRateOption,
  ReconstructionMode,
  WindowType,
} from '@/types/mathModel';
import './ProceduralEditorPanel.css';

export const ProceduralEditorPanel: React.FC = () => {
  const {
    recipe,
    mathModel,
    originalBuffer,
    reconstructionConfig,
    updateReconstructionConfig,
    setReconstructionMode,
    generateProceduralApproximation,
    isConverting,
    isPlaying,
    activePlaybackSource,
    playProcedural,
    stopPlayback,
    currentTime,
    editorSubTab,
    setEditorSubTab,
  } = useAudioStore();

  const [showAdvanced, setShowAdvanced] = useState(true);
  const [expandTerms, setExpandTerms] = useState(false);

  const isPlayingThis = isPlaying && activePlaybackSource === 'procedural';
  const nyquist = originalBuffer ? Math.floor(originalBuffer.sampleRate / 2) : 22050;

  const mathSummary = useMemo(() => {
    if (!mathModel) return null;
    return formatMathEquationSummary(mathModel, expandTerms ? 64 : 10);
  }, [mathModel, expandTerms]);

  const modeBadgeLabel = mathModel
    ? `${mathModel.mode.toUpperCase()} · ${mathModel.representation}`
    : recipe.category || 'Procedural';

  const isExact = reconstructionConfig.mode === 'exact';
  const isOptimized = reconstructionConfig.mode === 'optimized';

  return (
    <Card
      title="2. Math Reconstruction & Controls"
      subtitle="S(t) = Σ A[n]·sin(2π·f[n]·t + φ[n]) synthesis parameters"
      actions={
        <div className="procedural-editor-panel__header-actions">
          <Badge variant="accent">{modeBadgeLabel}</Badge>
          <Button
            variant={isPlayingThis ? 'active' : 'primary'}
            size="xs"
            onClick={isPlayingThis ? () => stopPlayback(true) : () => playProcedural()}
            title="Preview reconstructed mathematical audio"
            aria-label={isPlayingThis ? 'Stop procedural sound' : 'Play procedural sound'}
          >
            <AcornIcon name={isPlayingThis ? 'stop' : 'play'} size={12} />
            {isPlayingThis ? `Stop (${currentTime.toFixed(2)}s)` : 'Play Sound'}
          </Button>
        </div>
      }
      className="procedural-editor-panel"
    >
      <div className="procedural-editor-panel__tabs">
        <Tabs
          tabs={[
            {
              id: 'math',
              label: 'Math & Optimization',
              icon: <AcornIcon name="sliders" size={13} />,
              badge: mathModel ? mathModel.mode : undefined,
            },
            {
              id: 'layers',
              label: 'Manual Layer Editor',
              icon: <AcornIcon name="wave" size={13} />,
              badge: `${recipe.layers.length}`,
            },
          ]}
          activeTab={editorSubTab}
          onChange={(id) => setEditorSubTab(id as 'math' | 'layers')}
        />
      </div>

      {editorSubTab === 'math' ? (
        <div className="math-controls-panel">
          {/* Reconstruction Mode & Primary Action */}
          <div className="math-section">
            <div className="math-section__header">
              <span className="section-title">Reconstruction Mode</span>
              {originalBuffer && (
                <Button
                  variant="primary"
                  size="xs"
                  onClick={generateProceduralApproximation}
                  disabled={isConverting}
                >
                  <AcornIcon name="sparkle" size={12} />
                  {isConverting ? 'Computing...' : 'Apply & Reconstruct'}
                </Button>
              )}
            </div>

            <div className="control-grid-2">
              <Select
                id="reconstruction-mode-select"
                label="Mode"
                value={reconstructionConfig.mode}
                options={[
                  { value: 'exact', label: 'Exact (Fourier Baseline)' },
                  { value: 'optimized', label: 'Optimized (Quality / Size)' },
                  { value: 'procedural', label: 'Procedural (Compact Approx.)' },
                ]}
                onChange={(e) => setReconstructionMode(e.target.value as ReconstructionMode)}
              />

              <Select
                id="output-sample-rate-select"
                label="Output Sample Rate"
                value={String(reconstructionConfig.outputSampleRate)}
                options={[
                  {
                    value: 'original',
                    label: originalBuffer
                      ? `Match Original (${originalBuffer.sampleRate} Hz)`
                      : 'Match Original',
                  },
                  { value: '48000', label: '48,000 Hz' },
                  { value: '44100', label: '44,100 Hz' },
                  { value: '22050', label: '22,050 Hz (Half)' },
                  { value: '16000', label: '16,000 Hz (Compact)' },
                ]}
                onChange={(e) => {
                  const val = e.target.value;
                  const parsed: OutputSampleRateOption =
                    val === 'original' ? 'original' : (Number(val) as 48000 | 44100 | 22050 | 16000);
                  updateReconstructionConfig({ outputSampleRate: parsed });
                }}
              />
            </div>

            {isExact && (
              <p className="mode-info-banner">
                <strong>Exact Mode:</strong> Retains all STFT Fourier coefficients (DC through
                Nyquist) with exact phase for numerical-precision baseline reconstruction. Output is
                typically larger than compressed MP3/OGG audio.
              </p>
            )}
            {reconstructionConfig.mode === 'procedural' && (
              <p className="mode-info-banner">
                <strong>Procedural Approximation:</strong> Fits compact closed-form functions
                (sines, frequency sweeps, FM/AM, exponential decays) derived from your audio. Ideal
                for tiny code footprint; broadband noises/explosions are approximated.
              </p>
            )}
          </div>

          {/* Quality & Optimization Controls */}
          {!isExact && (
            <div className="math-section">
              <div className="section-title">Quality & Optimization</div>
              <div className="control-grid-2">
                <SliderWithInput
                  label="Max Oscillators"
                  value={reconstructionConfig.maxOscillators}
                  defaultValue={32}
                  min={1}
                  max={reconstructionConfig.mode === 'procedural' ? 16 : 256}
                  step={1}
                  unit=""
                  onChange={(val) => updateReconstructionConfig({ maxOscillators: Math.round(val) })}
                />
                <SliderWithInput
                  label="Target Quality"
                  value={reconstructionConfig.targetQuality}
                  defaultValue={0.95}
                  min={0.1}
                  max={0.999}
                  step={0.01}
                  unit="%"
                  displayMultiplier={100}
                  displayDecimals={1}
                  onChange={(val) => updateReconstructionConfig({ targetQuality: val })}
                />
              </div>

              <div className="control-grid-2">
                <SliderWithInput
                  label="Min Amplitude Threshold"
                  value={reconstructionConfig.minAmplitudeDb}
                  defaultValue={-60}
                  min={-96}
                  max={-6}
                  step={2}
                  unit="dB"
                  onChange={(val) => updateReconstructionConfig({ minAmplitudeDb: val })}
                />
                <SliderWithInput
                  label="Compression Aggressiveness"
                  value={reconstructionConfig.compressionAggressiveness}
                  defaultValue={0.3}
                  min={0}
                  max={1}
                  step={0.05}
                  unit="%"
                  displayMultiplier={100}
                  displayDecimals={0}
                  onChange={(val) =>
                    updateReconstructionConfig({ compressionAggressiveness: val })
                  }
                />
              </div>

              <div className="control-grid-2">
                <SliderWithInput
                  label="Min Frequency"
                  value={reconstructionConfig.minFrequency}
                  defaultValue={20}
                  min={0}
                  max={Math.max(100, Math.min(8000, nyquist - 100))}
                  step={10}
                  unit="Hz"
                  onChange={(val) => updateReconstructionConfig({ minFrequency: val })}
                />
                <SliderWithInput
                  label="Max Frequency"
                  value={Math.min(reconstructionConfig.maxFrequency, nyquist)}
                  defaultValue={Math.min(20000, nyquist)}
                  min={200}
                  max={nyquist}
                  step={100}
                  unit="Hz"
                  onChange={(val) => updateReconstructionConfig({ maxFrequency: val })}
                />
              </div>

              <div className="checkbox-controls-row">
                <label className="checkbox-label">
                  <input
                    id="preserve-phase-checkbox"
                    type="checkbox"
                    checked={reconstructionConfig.preservePhase}
                    onChange={(e) =>
                      updateReconstructionConfig({ preservePhase: e.target.checked })
                    }
                  />
                  <span>Preserve Phase (φ)</span>
                </label>

                <label className="checkbox-label">
                  <input
                    id="residual-noise-checkbox"
                    type="checkbox"
                    checked={reconstructionConfig.enableResidualNoise}
                    onChange={(e) =>
                      updateReconstructionConfig({ enableResidualNoise: e.target.checked })
                    }
                  />
                  <span>Transient / Residual Noise Model</span>
                </label>
              </div>
            </div>
          )}

          {/* Advanced FFT / STFT Parameters */}
          <div className="math-section">
            <div className="math-section__header">
              <span className="section-title">Advanced FFT / STFT Settings</span>
              <Button
                variant="ghost"
                size="xs"
                onClick={() => setShowAdvanced((v) => !v)}
                aria-expanded={showAdvanced}
              >
                <AcornIcon name={showAdvanced ? 'chevron-up' : 'chevron-down'} size={12} />
                {showAdvanced ? 'Hide' : 'Show'}
              </Button>
            </div>

            {showAdvanced && (
              <div className="advanced-grid">
                <div className="control-grid-2">
                  <Select
                    id="fft-size-select"
                    label="FFT Size"
                    value={String(reconstructionConfig.fftSize)}
                    options={[
                      { value: '256', label: '256 bins' },
                      { value: '512', label: '512 bins' },
                      { value: '1024', label: '1024 bins' },
                      { value: '2048', label: '2048 bins' },
                      { value: '4096', label: '4096 bins' },
                    ]}
                    onChange={(e) => updateReconstructionConfig({ fftSize: Number(e.target.value) })}
                  />
                  <Select
                    id="window-size-select"
                    label="Analysis Window"
                    value={String(reconstructionConfig.windowSize)}
                    options={[256, 512, 1024, 2048, 4096]
                      .filter((s) => s <= reconstructionConfig.fftSize)
                      .map((s) => ({ value: String(s), label: `${s} samples` }))}
                    onChange={(e) =>
                      updateReconstructionConfig({ windowSize: Number(e.target.value) })
                    }
                  />
                </div>

                <div className="control-grid-2">
                  <Select
                    id="hop-size-select"
                    label="Hop Size"
                    value={String(reconstructionConfig.hopSize)}
                    options={[64, 128, 256, 512, 1024]
                      .filter((h) => h <= reconstructionConfig.windowSize)
                      .map((h) => ({
                        value: String(h),
                        label: `${h} (${Math.round((1 - h / reconstructionConfig.windowSize) * 100)}% overlap)`,
                      }))}
                    onChange={(e) => updateReconstructionConfig({ hopSize: Number(e.target.value) })}
                  />
                  <Select
                    id="window-type-select"
                    label="Window Function"
                    value={reconstructionConfig.windowType}
                    options={[
                      { value: 'sqrt-hann', label: 'Sqrt-Hann (COLA WOLA)' },
                      { value: 'hann', label: 'Periodic Hann' },
                      { value: 'hamming', label: 'Hamming' },
                      { value: 'blackman-harris', label: 'Blackman-Harris' },
                      { value: 'rectangular', label: 'Rectangular (Block DFT)' },
                    ]}
                    onChange={(e) =>
                      updateReconstructionConfig({ windowType: e.target.value as WindowType })
                    }
                  />
                </div>

                {isOptimized && (
                  <Select
                    id="optimized-method-select"
                    label="Optimized Synthesis Engine"
                    value={reconstructionConfig.optimizedMethod}
                    options={[
                      { value: 'auto', label: 'Auto (Tracks for Tonal, STFT for Noise/Impulses)' },
                      { value: 'sinusoidal-tracks', label: 'Sinusoidal Tracks (McAulay-Quatieri)' },
                      { value: 'stft-sparse', label: 'Sparse STFT Sinusoids (Overlap-Add)' },
                    ]}
                    onChange={(e) =>
                      updateReconstructionConfig({
                        optimizedMethod: e.target.value as OptimizedMethod,
                      })
                    }
                  />
                )}
              </div>
            )}
          </div>

          {/* Expandable Mathematical Representation */}
          <div className="math-section math-formula-box">
            <div className="math-section__header">
              <span className="section-title">Mathematical Representation</span>
              {mathSummary && mathSummary.totalTermCount > 10 && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setExpandTerms((e) => !e)}
                >
                  {expandTerms
                    ? 'Collapse Terms'
                    : `Expand (${mathSummary.totalTermCount.toLocaleString()} total)`}
                </Button>
              )}
            </div>

            {mathSummary ? (
              <>
                <div className="formula-equation">{mathSummary.headerFormula}</div>
                <p className="formula-notes">{mathSummary.notes}</p>
                <div className="formula-terms-list">
                  {mathSummary.terms.map((term, idx) => (
                    <div key={idx} className="formula-term-row">
                      <span className="term-idx">#{idx + 1}</span>
                      <code>{term}</code>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="formula-placeholder">
                Upload an audio file and click <strong>Convert to Math</strong> to extract the
                sinusoidal equation <code>S(t) = Σ A[n] · sin(2π · f[n] · t + φ[n])</code>.
              </p>
            )}
          </div>
        </div>
      ) : (
        <div className="procedural-editor-panel__inner">
          <div className="procedural-editor-panel__layers-sidebar">
            <LayerList />
          </div>
          <div className="procedural-editor-panel__layer-params">
            <LayerEditor />
          </div>
        </div>
      )}
    </Card>
  );
};
