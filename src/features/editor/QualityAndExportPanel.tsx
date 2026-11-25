import React, { useState, useMemo } from 'react';
import { useAudioStore } from './useAudioStore';
import { Card } from '@/design-system/Card';
import { Button } from '@/design-system/Button';
import { Badge } from '@/design-system/Badge';
import { Select } from '@/design-system/Select';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import {
  calculateMathSizeReport,
  calculateSizeReport,
  formatBytes,
  formatCompressionRatio,
} from '@/audio/export/sizeCalculator';
import {
  generateReadableJson,
  generateMinifiedJson,
  generateStandaloneJs,
  generateStandaloneTs,
  generateRuntimePackage,
} from '@/audio/export/codeGenerators';
import {
  generateMathExport,
  generateMathJson,
  getExportFileExtension,
} from '@/audio/export/mathCodeGenerators';
import { audioBufferToWavBlob } from '@/audio/export/wav';
import { renderRecipeToBuffer } from '@/audio/rendering/renderer';
import { PresetKey } from '@/config/appConfig';
import { ExportLanguage } from '@/types/mathModel';
import './QualityAndExportPanel.css';

const PREVIEW_CHAR_LIMIT = 45000;

export const QualityAndExportPanel: React.FC = () => {
  const {
    recipe,
    mathModel,
    renderedProceduralBuffer,
    originalSizeBytes,
    executionTimings,
    preset,
    setPreset,
    exportLanguage,
    setExportLanguage,
    generateProceduralApproximation,
    isConverting,
  } = useAudioStore();

  const [copied, setCopied] = useState(false);
  const [isExportingWav, setIsExportingWav] = useState(false);
  const [showFullCode, setShowFullCode] = useState(false);

  const fullCodeContent = useMemo(() => {
    try {
      if (mathModel) {
        return generateMathExport(mathModel, exportLanguage);
      }
      if (exportLanguage === 'json') return generateReadableJson(recipe);
      if (exportLanguage === 'ts') return generateStandaloneTs(recipe);
      return generateStandaloneJs(recipe);
    } catch (e) {
      return `Error generating code: ${String(e)}`;
    }
  }, [mathModel, recipe, exportLanguage]);

  const previewContent = useMemo(() => {
    if (showFullCode || fullCodeContent.length <= PREVIEW_CHAR_LIMIT) {
      return fullCodeContent;
    }
    return (
      fullCodeContent.slice(0, PREVIEW_CHAR_LIMIT) +
      `\n\n/* ... Truncated in UI preview (${formatBytes(fullCodeContent.length)} total). Copy or Download gets the complete standalone file. */`
    );
  }, [fullCodeContent, showFullCode]);

  const mathSizeReport = useMemo(() => {
    if (!mathModel) return null;
    return calculateMathSizeReport(mathModel, originalSizeBytes, exportLanguage, fullCodeContent);
  }, [mathModel, originalSizeBytes, exportLanguage, fullCodeContent]);

  const recipeSizeReport = useMemo(() => {
    return calculateSizeReport(recipe, originalSizeBytes);
  }, [recipe, originalSizeBytes]);

  const baseName = (mathModel?.name || recipe.name || 'sound')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'sound';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(fullCodeContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard fallback ignored
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

  const downloadMathLanguage = (lang: ExportLanguage) => {
    if (mathModel) {
      const code = lang === exportLanguage ? fullCodeContent : generateMathExport(mathModel, lang);
      const mime = lang === 'json' ? 'application/json' : 'text/plain';
      triggerDownload(new Blob([code], { type: mime }), `${baseName}${getExportFileExtension(lang)}`);
      return;
    }

    // Fallback for built-in manual recipes when no uploaded audio has been converted yet
    if (lang === 'json') {
      triggerDownload(
        new Blob([generateReadableJson(recipe)], { type: 'application/json' }),
        `${baseName}.sfx.json`
      );
    } else if (lang === 'ts') {
      triggerDownload(
        new Blob([generateStandaloneTs(recipe)], { type: 'text/typescript' }),
        `${baseName}.player.ts`
      );
    } else {
      triggerDownload(
        new Blob([generateStandaloneJs(recipe)], { type: 'text/javascript' }),
        `${baseName}.player.js`
      );
    }
  };

  const downloadMinifiedJson = () => {
    if (mathModel) {
      const json = generateMathJson(mathModel, false);
      triggerDownload(new Blob([json], { type: 'application/json' }), `${baseName}.min.math.json`);
    } else {
      const json = generateMinifiedJson(recipe);
      triggerDownload(new Blob([json], { type: 'application/json' }), `${baseName}.min.sfx.json`);
    }
  };

  const exportWav = async () => {
    setIsExportingWav(true);
    try {
      const buffer = renderedProceduralBuffer ?? (await renderRecipeToBuffer(recipe, 44100));
      const wavBlob = audioBufferToWavBlob(buffer);
      triggerDownload(wavBlob, `${baseName}.wav`);
    } finally {
      setIsExportingWav(false);
    }
  };

  const exportRuntimeFiles = () => {
    if (mathModel) {
      triggerDownload(
        new Blob([generateMathExport(mathModel, 'js')], { type: 'text/javascript' }),
        `${baseName}.sound.js`
      );
      triggerDownload(
        new Blob([generateMathJson(mathModel, false)], { type: 'application/json' }),
        `${baseName}.min.math.json`
      );
      return;
    }
    const pkg = generateRuntimePackage(recipe);
    for (const [filename, content] of Object.entries(pkg)) {
      triggerDownload(new Blob([content], { type: 'text/plain' }), filename);
    }
  };

  const langTabs: { id: ExportLanguage; label: string; mathOnly?: boolean }[] = [
    { id: 'js', label: 'JavaScript' },
    { id: 'ts', label: 'TypeScript' },
    { id: 'c', label: 'C', mathOnly: true },
    { id: 'cpp', label: 'C++', mathOnly: true },
    { id: 'python', label: 'Python', mathOnly: true },
    { id: 'json', label: 'JSON' },
  ];

  const isLarger = mathSizeReport
    ? mathSizeReport.isCodeLargerThanOriginal
    : recipeSizeReport.isLargerThanOriginal;

  return (
    <Card
      title="4. Size, Trade-Offs & Standalone Export"
      subtitle="Measured UTF-8 footprint and standalone JS / TS / C / C++ / Python / JSON code"
      className="quality-export-panel"
    >
      <div className="quality-export-panel__inner">
        {/* Preset Selector */}
        <div className="preset-selector-bar">
          <div className="preset-left">
            <span className="preset-title">Preset:</span>
            <Select
              id="export-preset-select"
              value={preset}
              options={[
                { value: 'tiny', label: 'Tiny (Procedural Approx.)' },
                { value: 'balanced', label: 'Balanced (Optimized)' },
                { value: 'accurate', label: 'Accurate (High-Res Optimized)' },
                { value: 'exact', label: 'Exact (Fourier Baseline)' },
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
              title="Re-run mathematical conversion with selected preset"
            >
              Re-convert ({preset.toUpperCase()})
            </Button>
          )}
        </div>

        {/* Honest Byte Footprint Breakdown */}
        <div className="size-metrics-card">
          <div className="size-metrics-header">
            <span className="size-metrics-title">Measured Footprint &amp; Compression</span>
            {mathSizeReport && mathSizeReport.originalFileSizeBytes > 0 ? (
              <Badge variant={isLarger ? 'warning' : 'success'}>
                {formatCompressionRatio(mathSizeReport.codeCompressionRatio)}
              </Badge>
            ) : recipeSizeReport.originalSizeBytes > 0 ? (
              <Badge variant={recipeSizeReport.isLargerThanOriginal ? 'warning' : 'success'}>
                {recipeSizeReport.isLargerThanOriginal
                  ? 'Larger than Original'
                  : `${recipeSizeReport.reductionPercentage}% Smaller`}
              </Badge>
            ) : null}
          </div>

          {mathSizeReport ? (
            <div className="size-grid">
              <div className="size-stat-box">
                <span className="stat-label">Original Audio File</span>
                <span className="stat-value">
                  {mathSizeReport.originalFileSizeBytes > 0
                    ? formatBytes(mathSizeReport.originalFileSizeBytes)
                    : 'N/A'}
                </span>
                <span className="stat-note">
                  Raw 16-bit PCM: {formatBytes(mathSizeReport.uncompressedPcm16Bytes)}
                </span>
              </div>

              <div className="size-stat-box highlight">
                <span className="stat-label">Math Definition JSON</span>
                <span className="stat-value">
                  {formatBytes(mathSizeReport.mathJsonMinifiedBytes)}
                </span>
                <span className="stat-note">
                  {formatCompressionRatio(mathSizeReport.jsonCompressionRatio)}
                </span>
              </div>

              <div className="size-stat-box highlight">
                <span className="stat-label">Generated {exportLanguage.toUpperCase()} Code</span>
                <span className="stat-value">
                  {formatBytes(mathSizeReport.generatedCodeBytes)}
                </span>
                <span className="stat-note">
                  {formatCompressionRatio(mathSizeReport.codeCompressionRatio)}
                </span>
              </div>

              <div className="size-stat-box">
                <span className="stat-label">Representation</span>
                <span className="stat-value">{mathModel!.mode.toUpperCase()}</span>
                <span className="stat-note">{mathModel!.representation}</span>
              </div>

              <div className="size-stat-box">
                <span className="stat-label">Components</span>
                <span className="stat-value" title={mathSizeReport.componentSummary}>
                  {mathModel!.representation === 'procedural-math'
                    ? `${mathModel!.stats.partialCount} sines`
                    : mathModel!.representation === 'sinusoidal-tracks'
                      ? `${mathModel!.stats.totalTracks} tracks`
                      : `${mathModel!.stats.totalSinusoids.toLocaleString()} bins`}
                </span>
                <span className="stat-note">{mathSizeReport.componentSummary}</span>
              </div>

              <div className="size-stat-box">
                <span className="stat-label">Reconstruction Speed</span>
                <span className="stat-value">
                  {executionTimings ? `${executionTimings.reconstructionMs.toFixed(1)} ms` : '—'}
                </span>
                <span className="stat-note">
                  Total pipeline: {executionTimings ? `${executionTimings.totalMs.toFixed(0)} ms` : '—'}
                </span>
              </div>
            </div>
          ) : (
            <div className="size-grid">
              <div className="size-stat-box">
                <span className="stat-label">Original Audio File</span>
                <span className="stat-value">
                  {recipeSizeReport.originalSizeBytes > 0
                    ? formatBytes(recipeSizeReport.originalSizeBytes)
                    : 'N/A (Built-in)'}
                </span>
                <span className="stat-note">WAV/MP3/OGG source</span>
              </div>
              <div className="size-stat-box">
                <span className="stat-label">Procedural JSON</span>
                <span className="stat-value">{formatBytes(recipeSizeReport.minifiedJsonBytes)}</span>
                <span className="stat-note">Minified .sfx.json</span>
              </div>
              <div className="size-stat-box highlight">
                <span className="stat-label">Standalone JS Module</span>
                <span className="stat-value">{formatBytes(recipeSizeReport.totalFirstUseBytes)}</span>
                <span className="stat-note">Measured UTF-8 bytes</span>
              </div>
            </div>
          )}

          {mathSizeReport && mathSizeReport.isCodeLargerThanOriginal && (
            <p className="size-notice warning">
              <strong>Honest Size Notice:</strong> In <code>{mathModel?.mode}</code> mode, the
              generated standalone code ({formatBytes(mathSizeReport.generatedCodeBytes)}) is larger
              than the uploaded audio file ({formatBytes(mathSizeReport.originalFileSizeBytes)}).
              Exact Fourier reconstruction is a correctness baseline; switch to{' '}
              <strong>Optimized</strong> or <strong>Procedural</strong> mode (or increase
              Compression Aggressiveness / lower Max Oscillators) to shrink output size.
            </p>
          )}
        </div>

        {/* Export Buttons Grid */}
        <div className="export-actions-section">
          <span className="export-section-title">Standalone Code &amp; Audio Exports</span>
          <div className="export-buttons-grid">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadMathLanguage('js')}
              title="Download standalone JavaScript + Web Audio API module"
            >
              <AcornIcon name="download" size={14} />
              <span>Standalone JS</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadMathLanguage('ts')}
              title="Download standalone TypeScript + Web Audio API module"
            >
              <AcornIcon name="download" size={14} />
              <span>Standalone TS</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              disabled={!mathModel}
              onClick={() => downloadMathLanguage('c')}
              title="Download standalone ISO C99 implementation"
            >
              <AcornIcon name="download" size={14} />
              <span>Standalone C</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              disabled={!mathModel}
              onClick={() => downloadMathLanguage('cpp')}
              title="Download standalone C++17 implementation"
            >
              <AcornIcon name="download" size={14} />
              <span>Standalone C++</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              disabled={!mathModel}
              onClick={() => downloadMathLanguage('python')}
              title="Download standalone Python 3 (stdlib only) module"
            >
              <AcornIcon name="download" size={14} />
              <span>Standalone Python</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={() => downloadMathLanguage('json')}
              title="Download mathematical JSON definition"
            >
              <AcornIcon name="download" size={14} />
              <span>JSON Recipe</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={downloadMinifiedJson}
              title="Download compact minified JSON"
            >
              <AcornIcon name="download" size={14} />
              <span>Minified JSON</span>
            </Button>

            <Button
              variant="primary"
              size="sm"
              onClick={exportWav}
              disabled={isExportingWav}
              title="Export exclusively reconstructed mathematical audio as 16-bit WAV"
            >
              <AcornIcon name="download" size={14} />
              <span>{isExportingWav ? 'Rendering WAV...' : 'WAV Audio'}</span>
            </Button>

            {!mathModel && (
              <Button
                variant="secondary"
                size="sm"
                onClick={exportRuntimeFiles}
                title="Download procedural runtime package files"
              >
                <AcornIcon name="download" size={14} />
                <span>Runtime Package</span>
              </Button>
            )}
          </div>
        </div>

        {/* Code Preview Viewer */}
        <div className="code-preview-section">
          <div className="code-preview-header">
            <div className="code-preview-tabs">
              {langTabs.map((tab) => {
                const disabled = Boolean(tab.mathOnly && !mathModel);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    disabled={disabled}
                    className={`preview-tab-btn ${exportLanguage === tab.id ? 'active' : ''}`}
                    onClick={() => {
                      setExportLanguage(tab.id);
                      setShowFullCode(false);
                    }}
                    title={disabled ? 'Convert an uploaded audio file to export in this language' : tab.label}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="code-preview-actions">
              {fullCodeContent.length > PREVIEW_CHAR_LIMIT && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => setShowFullCode((v) => !v)}
                >
                  {showFullCode ? 'Truncate' : 'Show Full'}
                </Button>
              )}
              <Button variant="secondary" size="xs" onClick={handleCopy}>
                <AcornIcon name={copied ? 'check' : 'copy'} size={12} />
                {copied ? 'Copied!' : 'Copy Code'}
              </Button>
            </div>
          </div>

          <pre className="code-preview-block">
            <code>{previewContent}</code>
          </pre>
        </div>
      </div>
    </Card>
  );
};
