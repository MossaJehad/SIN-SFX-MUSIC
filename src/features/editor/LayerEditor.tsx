import React from 'react';
import { useAudioStore } from './useAudioStore';
import { SliderWithInput } from '@/design-system/SliderWithInput';
import { Select } from '@/design-system/Select';
import { Button } from '@/design-system/Button';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import { OscillatorType, FrequencyCurve } from '@/types/recipe';
import './LayerEditor.css';

export const LayerEditor: React.FC = () => {
  const {
    recipe,
    selectedLayerId,
    updateLayer,
    updateRecipe,
    playProcedural,
    isPlaying,
    activePlaybackSource,
    stopPlayback,
  } = useAudioStore();

  const layer = recipe.layers.find((l) => l.id === selectedLayerId) || recipe.layers[0];

  if (!layer) {
    return (
      <div className="layer-editor--empty">
        <p>No layer selected. Click "Add Layer" to create one.</p>
      </div>
    );
  }

  const isPlayingThis = isPlaying && activePlaybackSource === 'procedural';

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateLayer(layer.id, { name: e.target.value });
  };

  const handleOscChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateLayer(layer.id, { oscillatorType: e.target.value as OscillatorType });
  };

  const handleCurveChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    updateLayer(layer.id, { frequencyCurve: e.target.value as FrequencyCurve });
  };

  return (
    <div className="acorn-layer-editor">
      {/* Top Layer Header */}
      <div className="layer-editor__header">
        <div className="layer-editor__name-group">
          <label htmlFor="layer-name-input" className="visually-hidden">
            Layer Name
          </label>
          <input
            id="layer-name-input"
            type="text"
            value={layer.name}
            onChange={handleNameChange}
            className="layer-name-input"
            placeholder="Layer Name"
            maxLength={32}
          />
        </div>

        <div className="layer-editor__preview-actions">
          <Button
            variant={isPlayingThis ? 'active' : 'primary'}
            size="xs"
            onClick={isPlayingThis ? stopPlayback : playProcedural}
            title="Preview procedural sound effect"
          >
            <AcornIcon name={isPlayingThis ? 'stop' : 'play'} size={12} />
            {isPlayingThis ? 'Stop' : 'Preview'}
          </Button>
        </div>
      </div>

      {/* Global Recipe Master Settings */}
      <div className="layer-editor__section layer-editor__section--master">
        <div className="section-title">Sound Master</div>
        <div className="control-grid-2">
          <SliderWithInput
            label="Overall Duration"
            value={recipe.duration}
            defaultValue={0.3}
            min={0.03}
            max={3.0}
            step={0.01}
            unit="s"
            displayDecimals={2}
            onChange={(val) => updateRecipe((prev) => ({ ...prev, duration: val }))}
          />
          <SliderWithInput
            label="Master Gain"
            value={recipe.masterGain}
            defaultValue={0.8}
            min={0.1}
            max={1.0}
            step={0.05}
            unit=""
            displayDecimals={2}
            onChange={(val) => updateRecipe((prev) => ({ ...prev, masterGain: val }))}
          />
        </div>
      </div>

      {/* Oscillator & Timing */}
      <div className="layer-editor__section">
        <div className="section-title">Oscillator & Geometry</div>
        <div className="control-grid-2">
          <Select
            id={`osc-type-${layer.id}`}
            label="Oscillator Wave"
            value={layer.oscillatorType}
            options={[
              { value: 'sine', label: 'Sine (Pure / Sub)' },
              { value: 'triangle', label: 'Triangle (Warm)' },
              { value: 'square', label: 'Square (Chiptune)' },
              { value: 'sawtooth', label: 'Sawtooth (Buzzy / Laser)' },
              { value: 'noise', label: 'Noise (Percussion / Blast)' },
            ]}
            onChange={handleOscChange}
          />
          <SliderWithInput
            label="Pan"
            value={layer.pan}
            defaultValue={0}
            min={-1}
            max={1}
            step={0.05}
            unit=""
            displayDecimals={2}
            onChange={(val) => updateLayer(layer.id, { pan: val })}
          />
        </div>

        <div className="control-grid-2">
          <SliderWithInput
            label="Start Time"
            value={layer.startTime}
            defaultValue={0}
            min={0}
            max={recipe.duration}
            step={0.005}
            unit="s"
            displayDecimals={3}
            onChange={(val) => updateLayer(layer.id, { startTime: val })}
          />
          <SliderWithInput
            label="Duration"
            value={layer.duration}
            defaultValue={recipe.duration}
            min={0.01}
            max={recipe.duration}
            step={0.005}
            unit="s"
            displayDecimals={3}
            onChange={(val) => updateLayer(layer.id, { duration: val })}
          />
        </div>

        <SliderWithInput
          label="Layer Gain"
          value={layer.gain}
          defaultValue={0.8}
          min={0}
          max={1.2}
          step={0.02}
          unit=""
          displayDecimals={2}
          onChange={(val) => updateLayer(layer.id, { gain: val })}
        />
      </div>

      {/* Pitch & Frequency Sweep (if not noise) */}
      {layer.oscillatorType !== 'noise' && (
        <div className="layer-editor__section">
          <div className="section-title">Pitch & Frequency Sweep</div>
          <div className="control-grid-2">
            <SliderWithInput
              label="Start Frequency"
              value={layer.startFrequency}
              defaultValue={440}
              min={20}
              max={12000}
              step={10}
              unit="Hz"
              displayDecimals={0}
              onChange={(val) => updateLayer(layer.id, { startFrequency: val })}
            />
            <SliderWithInput
              label="End Frequency"
              value={layer.endFrequency}
              defaultValue={440}
              min={20}
              max={12000}
              step={10}
              unit="Hz"
              displayDecimals={0}
              onChange={(val) => updateLayer(layer.id, { endFrequency: val })}
            />
          </div>
          <Select
            id={`freq-curve-${layer.id}`}
            label="Frequency Interpolation Curve"
            value={layer.frequencyCurve}
            options={[
              { value: 'constant', label: 'Constant (No pitch change)' },
              { value: 'linear', label: 'Linear Pitch Sweep' },
              { value: 'exponential', label: 'Exponential Pitch Sweep (Perceptual)' },
            ]}
            onChange={handleCurveChange}
          />
        </div>
      )}

      {/* Amplitude Envelope (ADSR) */}
      <div className="layer-editor__section">
        <div className="section-title">Amplitude Envelope (ADSR)</div>
        <div className="control-grid-2">
          <SliderWithInput
            label="Attack"
            value={layer.envelope.attack}
            defaultValue={0.005}
            min={0.001}
            max={Math.max(0.1, layer.duration * 0.8)}
            step={0.001}
            unit="ms"
            displayMultiplier={1000}
            displayDecimals={1}
            onChange={(val) =>
              updateLayer(layer.id, { envelope: { ...layer.envelope, attack: val } })
            }
          />
          <SliderWithInput
            label="Decay"
            value={layer.envelope.decay}
            defaultValue={0.1}
            min={0.001}
            max={Math.max(0.1, layer.duration * 0.8)}
            step={0.001}
            unit="ms"
            displayMultiplier={1000}
            displayDecimals={1}
            onChange={(val) =>
              updateLayer(layer.id, { envelope: { ...layer.envelope, decay: val } })
            }
          />
        </div>
        <div className="control-grid-2">
          <SliderWithInput
            label="Sustain"
            value={layer.envelope.sustain}
            defaultValue={0.1}
            min={0}
            max={1.0}
            step={0.05}
            unit="%"
            displayMultiplier={100}
            displayDecimals={0}
            onChange={(val) =>
              updateLayer(layer.id, { envelope: { ...layer.envelope, sustain: val } })
            }
          />
          <SliderWithInput
            label="Release"
            value={layer.envelope.release}
            defaultValue={0.05}
            min={0.001}
            max={0.5}
            step={0.005}
            unit="ms"
            displayMultiplier={1000}
            displayDecimals={1}
            onChange={(val) =>
              updateLayer(layer.id, { envelope: { ...layer.envelope, release: val } })
            }
          />
        </div>
      </div>

      {/* Low-Pass Filter */}
      <div className="layer-editor__section">
        <div className="section-title-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layer.lowPassFilter.enabled}
              onChange={(e) =>
                updateLayer(layer.id, {
                  lowPassFilter: { ...layer.lowPassFilter, enabled: e.target.checked },
                })
              }
            />
            <span>Low-Pass Filter</span>
          </label>
        </div>
        {layer.lowPassFilter.enabled && (
          <div className="control-grid-2">
            <SliderWithInput
              label="Cutoff"
              value={layer.lowPassFilter.cutoff}
              defaultValue={4000}
              min={100}
              max={16000}
              step={50}
              unit="Hz"
              onChange={(val) =>
                updateLayer(layer.id, {
                  lowPassFilter: { ...layer.lowPassFilter, cutoff: val },
                })
              }
            />
            <SliderWithInput
              label="Resonance (Q)"
              value={layer.lowPassFilter.q}
              defaultValue={1.0}
              min={0.1}
              max={12.0}
              step={0.1}
              unit=""
              displayDecimals={1}
              onChange={(val) =>
                updateLayer(layer.id, {
                  lowPassFilter: { ...layer.lowPassFilter, q: val },
                })
              }
            />
          </div>
        )}
      </div>

      {/* High-Pass Filter */}
      <div className="layer-editor__section">
        <div className="section-title-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layer.highPassFilter.enabled}
              onChange={(e) =>
                updateLayer(layer.id, {
                  highPassFilter: { ...layer.highPassFilter, enabled: e.target.checked },
                })
              }
            />
            <span>High-Pass Filter</span>
          </label>
        </div>
        {layer.highPassFilter.enabled && (
          <div className="control-grid-2">
            <SliderWithInput
              label="Cutoff"
              value={layer.highPassFilter.cutoff}
              defaultValue={100}
              min={20}
              max={8000}
              step={20}
              unit="Hz"
              onChange={(val) =>
                updateLayer(layer.id, {
                  highPassFilter: { ...layer.highPassFilter, cutoff: val },
                })
              }
            />
            <SliderWithInput
              label="Q Factor"
              value={layer.highPassFilter.q}
              defaultValue={0.7}
              min={0.1}
              max={6.0}
              step={0.1}
              unit=""
              displayDecimals={1}
              onChange={(val) =>
                updateLayer(layer.id, {
                  highPassFilter: { ...layer.highPassFilter, q: val },
                })
              }
            />
          </div>
        )}
      </div>

      {/* Distortion / Waveshaper */}
      <div className="layer-editor__section">
        <div className="section-title-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layer.distortion.enabled}
              onChange={(e) =>
                updateLayer(layer.id, {
                  distortion: { ...layer.distortion, enabled: e.target.checked },
                })
              }
            />
            <span>Distortion / Saturation</span>
          </label>
        </div>
        {layer.distortion.enabled && (
          <SliderWithInput
            label="Drive Amount"
            value={layer.distortion.amount}
            defaultValue={0.2}
            min={0.0}
            max={1.0}
            step={0.02}
            unit="%"
            displayMultiplier={100}
            displayDecimals={0}
            onChange={(val) =>
              updateLayer(layer.id, {
                distortion: { ...layer.distortion, amount: val },
              })
            }
          />
        )}
      </div>

      {/* Delay Effect */}
      <div className="layer-editor__section">
        <div className="section-title-row">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={layer.delay.enabled}
              onChange={(e) =>
                updateLayer(layer.id, {
                  delay: { ...layer.delay, enabled: e.target.checked },
                })
              }
            />
            <span>Echo / Delay</span>
          </label>
        </div>
        {layer.delay.enabled && (
          <div className="control-grid-3">
            <SliderWithInput
              label="Time"
              value={layer.delay.time}
              defaultValue={0.06}
              min={0.01}
              max={0.3}
              step={0.005}
              unit="ms"
              displayMultiplier={1000}
              displayDecimals={0}
              onChange={(val) => updateLayer(layer.id, { delay: { ...layer.delay, time: val } })}
            />
            <SliderWithInput
              label="Feedback"
              value={layer.delay.feedback}
              defaultValue={0.25}
              min={0}
              max={0.8}
              step={0.05}
              unit="%"
              displayMultiplier={100}
              displayDecimals={0}
              onChange={(val) =>
                updateLayer(layer.id, { delay: { ...layer.delay, feedback: val } })
              }
            />
            <SliderWithInput
              label="Dry/Wet Mix"
              value={layer.delay.mix}
              defaultValue={0.2}
              min={0}
              max={1.0}
              step={0.05}
              unit="%"
              displayMultiplier={100}
              displayDecimals={0}
              onChange={(val) => updateLayer(layer.id, { delay: { ...layer.delay, mix: val } })}
            />
          </div>
        )}
      </div>

      {/* Frequency Modulation (FM) */}
      {layer.oscillatorType !== 'noise' && (
        <div className="layer-editor__section">
          <div className="section-title-row">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={layer.frequencyModulation.enabled}
                onChange={(e) =>
                  updateLayer(layer.id, {
                    frequencyModulation: {
                      ...layer.frequencyModulation,
                      enabled: e.target.checked,
                    },
                  })
                }
              />
              <span>Frequency Modulation (FM)</span>
            </label>
          </div>
          {layer.frequencyModulation.enabled && (
            <div className="control-grid-2">
              <SliderWithInput
                label="Modulator Frequency"
                value={layer.frequencyModulation.modFrequency}
                defaultValue={60}
                min={1}
                max={2000}
                step={5}
                unit="Hz"
                onChange={(val) =>
                  updateLayer(layer.id, {
                    frequencyModulation: {
                      ...layer.frequencyModulation,
                      modFrequency: val,
                    },
                  })
                }
              />
              <SliderWithInput
                label="Modulation Depth"
                value={layer.frequencyModulation.modDepth}
                defaultValue={100}
                min={0}
                max={3000}
                step={20}
                unit="Hz"
                onChange={(val) =>
                  updateLayer(layer.id, {
                    frequencyModulation: {
                      ...layer.frequencyModulation,
                      modDepth: val,
                    },
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      {/* Deterministic Seed */}
      <div className="layer-editor__section">
        <div className="section-title">Deterministic Seed (Noise PRNG)</div>
        <div className="seed-row">
          <span className="seed-label">Seed:</span>
          <span className="seed-value">{layer.seed}</span>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => updateLayer(layer.id, { seed: Math.floor(Math.random() * 100000) })}
            title="Generate new reproducible random seed"
          >
            <AcornIcon name="reset" size={12} />
            Randomize Seed
          </Button>
        </div>
      </div>
    </div>
  );
};
