import React, { useState, useMemo } from 'react';
import { useAudioStore } from './useAudioStore';
import { Card } from '@/design-system/Card';
import { Button } from '@/design-system/Button';
import { Badge } from '@/design-system/Badge';
import { Select } from '@/design-system/Select';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import { calculateSizeReport, formatBytes } from '@/audio/export/sizeCalculator';
import {
  generateReadableJson,
  generateMinifiedJson,
  generateStandaloneJs,
  generateStandaloneTs,
  generateRuntimePackage,
} from '@/audio/export/codeGenerators';
import { audioBufferToWavBlob } from '@/audio/export/wav';
import { renderRecipeToBuffer } from '@/audio/rendering/renderer';
import { PresetKey } from '@/config/appConfig';
import './QualityAndExportPanel.css';

export const QualityAndExportPanel: React.FC = () => {
  const {
    recipe,
    originalSizeBytes,
    comparisonMetrics,
    preset,
    setPreset,
    generateProceduralApproximation,
    isConverting,
  } = useAudioStore();

  const [previewTab, setPreviewTab] = useState<'json' | 'js' | 'ts'>('json');
  const [copied, setCopied] = useState(false);
  const [isExportingWav, setIsExportingWav] = useState(false);

  // Calculate size report
  const sizeReport = useMemo(() => {
    return calculateSizeReport(recipe, originalSizeBytes);
  }, [recipe, originalSizeBytes]);

  // Code preview content
  const previewContent = useMemo(() => {
    try {
      if (previewTab === 'json') return generateReadableJson(recipe);
      if (previewTab === 'js') return generateStandaloneJs(recipe);
      if (previewTab === 'ts') return generateStandaloneTs(recipe);
    } catch (e) {
      return `Error generating code: ${String(e)}`;
    }
    return '';
  }, [recipe, previewTab]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(previewContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const triggerDownload = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportReadableJson = () => {
    const json = generateReadableJson(recipe);
    const blob = new Blob([json], { type: 'application/json' });
    triggerDownload(blob, `${recipe.name.toLowerCase().replace(/\s+/g, '-')}.sfx.json`);
  };

  const exportMinifiedJson = () => {
    const json = generateMinifiedJson(recipe);
    const blob = new Blob([json], { type: 'application/json' });
    triggerDownload(blob, `${recipe.name.toLowerCase().replace(/\s+/g, '-')}.min.sfx.json`);
  };

  const exportJs = () => {
    const js = generateStandaloneJs(recipe);
    const blob = new Blob([js], { type: 'text/javascript' });
    triggerDownload(blob, `${recipe.name.toLowerCase().replace(/\s+/g, '-')}.player.js`);
  };

  const exportTs = () => {
    const ts = generateStandaloneTs(recipe);
    const blob = new Blob([ts], { type: 'text/typescript' });
    triggerDownload(blob, `${recipe.name.toLowerCase().replace(/\s+/g, '-')}.player.ts`);
  };

  const exportWav = async () => {
    setIsExportingWav(true);
    try {
      const buffer = await renderRecipeToBuffer(recipe, 44100);
      const wavBlob = audioBufferToWavBlob(buffer);
      triggerDownload(wavBlob, `${recipe.name.toLowerCase().replace(/\s+/g, '-')}.wav`);
    } finally {
      setIsExportingWav(false);
    }
  };

  const exportRuntimeFiles = () => {
    const pkg = generateRuntimePackage(recipe);
    for (const [filename, content] of Object.entries(pkg)) {
      const blob = new Blob([content], { type: 'text/plain' });
      triggerDownload(blob, filename);
    }
  };

  return (
    <Card
      title="4. Quality, Size & Export"
      subtitle="Honest byte footprint analysis and standalone zero-dependency exports"
      className="quality-export-panel"
    >
      <div className="quality-export-panel__inner">
        {/* Preset Selector */}
        <div className="preset-selector-bar">
          <div className="preset-left">
            <span className="preset-title">Quality & Size Preset:</span>
            <Select
              id="export-preset-select"
              value={preset}
              options={[
                { value: 'tiny', label: 'Tiny (Max Reduction, 1-2 layers)' },
                { value: 'balanced', label: 'Balanced (Recommended, 2-3 layers)' },
                { value: 'accurate', label: 'Accurate (Fidelity, pitch sweeps & harmonics)' },
              ]}
              onChange={(e) => setPreset(e.target.value as PresetKey)}
            />
          </div>
          {originalSizeBytes > 0 && (
            <Button
              variant="secondary"
              size="xs"
              onClick={generateProceduralApproximation}
              disabled={isConverting}
              title="Regenerate recipe with current preset"
            >
              Re-generate with {preset.toUpperCase()}
            </Button>
          )}
        </div>

        {/* Size Comparison Metrics Card */}
        <div className="size-metrics-card">
          <div className="size-metrics-header">
            <span className="size-metrics-title">Byte Footprint Breakdown</span>
            {sizeReport.isLargerThanOriginal ? (
              <Badge variant="warning">Procedural Is Larger</Badge>
            ) : sizeReport.originalSizeBytes > 0 ? (
              <Badge variant="success">{sizeReport.reductionPercentage}% Smaller</Badge>
            ) : null}
          </div>

          <div className="size-grid">
            <div className="size-stat-box">
              <span className="stat-label">Original Audio File</span>
              <span className="stat-value">
                {sizeReport.originalSizeBytes > 0
                  ? formatBytes(sizeReport.originalSizeBytes)
                  : 'N/A (Built-in)'}
              </span>
              <span className="stat-note">WAV/MP3/OGG source</span>
            </div>

            <div className="size-stat-box">
              <span className="stat-label">Procedural Recipe JSON</span>
              <span className="stat-value">{formatBytes(sizeReport.minifiedJsonBytes)}</span>
              <span className="stat-note">Minified .sfx.json</span>
            </div>

            <div className="size-stat-box">
              <span className="stat-label">Standalone Runtime Engine</span>
              <span className="stat-value">{formatBytes(sizeReport.standaloneRuntimeBytes)}</span>
              <span className="stat-note">One-time engine script</span>
            </div>

            <div className="size-stat-box highlight">
              <span className="stat-label">Total First-Use Cost</span>
              <span className="stat-value">{formatBytes(sizeReport.totalFirstUseBytes)}</span>
              <span className="stat-note">Runtime + 1st sound recipe</span>
            </div>

            <div className="size-stat-box highlight">
              <span className="stat-label">Additional Sound Cost</span>
              <span className="stat-value">{formatBytes(sizeReport.additionalSoundBytes)}</span>
              <span className="stat-note">Per extra sound in game</span>
            </div>

            <div className="size-stat-box">
              <span className="stat-label">Estimated Synthesis Cost</span>
              <span className="stat-value">
                {sizeReport.estimatedSynthesisCost.cpuLevel} (
                {sizeReport.estimatedSynthesisCost.totalActiveNodes} nodes)
              </span>
              <span className="stat-note">
                {sizeReport.estimatedSynthesisCost.oscillators} osc,{' '}
                {sizeReport.estimatedSynthesisCost.filters} filters
              </span>
            </div>
          </div>

          {sizeReport.isLargerThanOriginal && (
            <p className="size-notice warning">
              Note: Because the uploaded audio file is very small or heavily compressed (
              {formatBytes(sizeReport.originalSizeBytes)}), the initial standalone bundle (
              {formatBytes(sizeReport.totalFirstUseBytes)}) is larger than the raw asset. File size
              savings compound as you share the runtime engine across multiple sounds.
            </p>
          )}

          {comparisonMetrics && (
            <div className="fidelity-row">
              <span>Approximation Fidelity: </span>
              <strong>{comparisonMetrics.approximationScore}%</strong>
              <span className="fidelity-detail">
                ({comparisonMetrics.label} · {sizeReport.layerCount} procedural layers)
              </span>
            </div>
          )}
        </div>

        {/* Export Buttons Grid */}
        <div className="export-actions-section">
          <span className="export-section-title">Export Formats</span>
          <div className="export-buttons-grid">
            <Button
              variant="secondary"
              size="sm"
              onClick={exportReadableJson}
              title={`Download readable JSON recipe (${formatBytes(sizeReport.readableJsonBytes)})`}
            >
              <AcornIcon name="download" size={14} />
              <span>JSON Recipe</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={exportMinifiedJson}
              title={`Download minified JSON recipe (${formatBytes(sizeReport.minifiedJsonBytes)})`}
            >
              <AcornIcon name="download" size={14} />
              <span>Minified JSON</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={exportJs}
              title="Download standalone zero-dependency JavaScript module"
            >
              <AcornIcon name="download" size={14} />
              <span>Standalone JS</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={exportTs}
              title="Download standalone zero-dependency TypeScript module"
            >
              <AcornIcon name="download" size={14} />
              <span>Standalone TS</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={exportWav}
              disabled={isExportingWav}
              title="Export synthesized procedural sound as 44.1kHz WAV"
            >
              <AcornIcon name="download" size={14} />
              <span>{isExportingWav ? 'Rendering WAV...' : 'WAV Audio'}</span>
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={exportRuntimeFiles}
              title="Download runtime package bundle with audio engine, recipe, and player"
            >
              <AcornIcon name="download" size={14} />
              <span>Runtime Package</span>
            </Button>
          </div>
        </div>

        {/* Code Preview Viewer */}
        <div className="code-preview-section">
          <div className="code-preview-header">
            <div className="code-preview-tabs">
              <button
                type="button"
                className={`preview-tab-btn ${previewTab === 'json' ? 'active' : ''}`}
                onClick={() => setPreviewTab('json')}
              >
                Recipe JSON
              </button>
              <button
                type="button"
                className={`preview-tab-btn ${previewTab === 'js' ? 'active' : ''}`}
                onClick={() => setPreviewTab('js')}
              >
                Standalone JavaScript
              </button>
              <button
                type="button"
                className={`preview-tab-btn ${previewTab === 'ts' ? 'active' : ''}`}
                onClick={() => setPreviewTab('ts')}
              >
                TypeScript
              </button>
            </div>

            <Button variant="secondary" size="xs" onClick={handleCopy}>
              <AcornIcon name={copied ? 'check' : 'copy'} size={12} />
              {copied ? 'Copied!' : 'Copy Code'}
            </Button>
          </div>

          <pre className="code-preview-block">
            <code>{previewContent}</code>
          </pre>
        </div>
      </div>
    </Card>
  );
};
