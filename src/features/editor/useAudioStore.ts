import { create } from 'zustand';
import { SoundRecipe, SoundLayer } from '@/types/recipe';
import { AudioAnalysisResult } from '@/types/analysis';
import {
  ExecutionTimings,
  ExportLanguage,
  MathConversionResult,
  MathSoundModel,
  ReconstructionConfig,
  ReconstructionMetrics,
  ReconstructionMode,
} from '@/types/mathModel';
import { APP_CONFIG, DEFAULT_RECONSTRUCTION_CONFIG, PresetKey } from '@/config/appConfig';
import {
  ComparisonMetrics,
  calculateApproximationScore,
  compareAudioSignals,
} from '@/audio/comparison/comparator';
import { BUILT_IN_EXAMPLES } from '@/examples/builtInExamples';
import { renderRecipeToBuffer } from '@/audio/rendering/renderer';
import { analyzeAudioBuffer, analyzeAudioSamples } from '@/audio/analysis/analyzer';
import {
  createAudioBufferFromChannels,
  extractAudioBufferChannels,
  loadAndDecodeAudioFile,
} from '@/audio/analysis/audioLoader';
import { convertAudioToMath } from '@/audio/math/mathPipeline';
import { proceduralModelToSoundRecipe } from '@/audio/math/proceduralEngine';
import { resampleChannels } from '@/audio/analysis/resampler';

export type PlaybackSource = 'original' | 'procedural' | 'difference' | null;

export interface AudioStoreState {
  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // Preset & Mathematical Reconstruction Configuration
  preset: PresetKey;
  setPreset: (preset: PresetKey) => void;
  reconstructionConfig: ReconstructionConfig;
  updateReconstructionConfig: (partial: Partial<ReconstructionConfig>) => void;
  setReconstructionMode: (mode: ReconstructionMode) => void;

  // Original Audio
  originalFileName: string | null;
  originalSizeBytes: number;
  originalBuffer: AudioBuffer | null;
  originalChannels: Float32Array[] | null;
  originalAnalysis: AudioAnalysisResult | null;
  originalWarning: string | null;
  isOriginalLoading: boolean;
  originalError: string | null;

  // Mathematical Conversion & Reconstructed Output
  mathModel: MathSoundModel | null;
  reconstructedChannels: Float32Array[] | null;
  differenceBuffer: AudioBuffer | null;
  reconstructionMetrics: ReconstructionMetrics | null;
  executionTimings: ExecutionTimings | null;
  exportLanguage: ExportLanguage;
  setExportLanguage: (lang: ExportLanguage) => void;

  // Procedural Recipe & Rendering (synced with Procedural mode & manual editor)
  recipe: SoundRecipe;
  renderedProceduralBuffer: AudioBuffer | null;
  comparisonMetrics: ComparisonMetrics | null;
  isRenderingProcedural: boolean;
  isConverting: boolean;
  conversionProgress: number;
  conversionStatusMessage: string;

  // History (Undo / Redo)
  history: SoundRecipe[];
  historyIndex: number;

  // Playback
  isPlaying: boolean;
  activePlaybackSource: PlaybackSource;
  currentTime: number;
  playbackDuration: number;
  zoom: number;

  // UI Selection
  selectedLayerId: string | null;
  activeMainTab: 'editor' | 'comparison' | 'export';
  editorSubTab: 'math' | 'layers';
  setEditorSubTab: (tab: 'math' | 'layers') => void;
  isAboutModalOpen: boolean;

  // Actions
  loadAudioFromFile: (file: File) => Promise<void>;
  clearOriginalAudio: () => void;
  loadExampleRecipe: (exampleKey: string) => Promise<void>;
  generateProceduralApproximation: () => Promise<void>;
  cancelConversion: () => void;
  updateRecipe: (
    updater: (prev: SoundRecipe) => SoundRecipe,
    pushHistory?: boolean
  ) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  addLayer: () => void;
  duplicateLayer: (layerId: string) => void;
  deleteLayer: (layerId: string) => void;
  toggleLayerEnabled: (layerId: string) => void;
  toggleLayerSolo: (layerId: string) => void;
  reorderLayers: (startIndex: number, endIndex: number) => void;
  updateLayer: (layerId: string, partial: Partial<SoundLayer>) => void;
  setSelectedLayerId: (layerId: string | null) => void;
  setActiveMainTab: (tab: 'editor' | 'comparison' | 'export') => void;
  setIsAboutModalOpen: (open: boolean) => void;
  setZoom: (zoom: number) => void;

  // Playback Actions
  playOriginal: (fromTime?: number) => Promise<void>;
  playProcedural: (fromTime?: number) => Promise<void>;
  playDifference: (fromTime?: number) => Promise<void>;
  stopPlayback: (resetCursor?: boolean) => void;
  toggleABPlayback: () => Promise<void>;
  seek: (seconds: number) => void;
}

// Global AudioContext & Worker resource management (cleaned up deterministically)
let globalAudioContext: AudioContext | null = null;
let currentSourceNode: AudioBufferSourceNode | null = null;
let playbackStartCtxTime = 0;
let playbackStartOffset = 0;
let animFrameId = 0;
let activeWorker: Worker | null = null;
let currentJobId = 0;
let cancelMainThreadFlag = false;

function getAudioContext(): AudioContext {
  if (!globalAudioContext || globalAudioContext.state === 'closed') {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    globalAudioContext = new AudioContextClass();
  }
  if (globalAudioContext.state === 'suspended') {
    void globalAudioContext.resume();
  }
  return globalAudioContext;
}

function terminateActiveWorker(): void {
  if (activeWorker) {
    try {
      activeWorker.postMessage({ type: 'CANCEL', jobId: currentJobId });
      activeWorker.terminate();
    } catch {
      // Ignore cleanup errors
    }
    activeWorker = null;
  }
}

function runMathConversionInWorker(
  channels: Float32Array[],
  sampleRate: number,
  config: ReconstructionConfig,
  name: string,
  onProgress: (progress: number, message: string) => void
): Promise<MathConversionResult> {
  terminateActiveWorker();
  const jobId = ++currentJobId;
  cancelMainThreadFlag = false;

  // Clone buffers before transfer so store retains originalChannels intact!
  const clonedChannels = channels.map((c) => new Float32Array(c));

  if (typeof Worker !== 'undefined') {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(
          new URL('../../workers/conversionWorker.ts', import.meta.url),
          { type: 'module' }
        );
        activeWorker = worker;

        worker.onmessage = (e: MessageEvent) => {
          const data = e.data;
          if (!data || data.jobId !== jobId) return;

          if (data.type === 'PROGRESS') {
            onProgress(data.progress, data.message);
          } else if (data.type === 'COMPLETE') {
            terminateActiveWorker();
            resolve(data.result as MathConversionResult);
          } else if (data.type === 'CANCELLED') {
            terminateActiveWorker();
            reject(new Error('CANCELLED'));
          } else if (data.type === 'ERROR') {
            terminateActiveWorker();
            reject(new Error(data.error || 'Worker conversion failed'));
          }
        };

        worker.onerror = (err) => {
          terminateActiveWorker();
          reject(new Error(err.message || 'Web Worker execution error'));
        };

        const transferables = clonedChannels.map((c) => c.buffer);
        worker.postMessage(
          {
            type: 'CONVERT_MATH',
            jobId,
            channels: clonedChannels,
            sampleRate,
            config,
            name,
          },
          transferables
        );
      } catch {
        // Fallback cleanly if Worker instantiation is unsupported in test runner
        try {
          const result = convertAudioToMath(clonedChannels, sampleRate, config, {
            name,
            isCancelled: () => cancelMainThreadFlag,
            onProgress,
          });
          resolve(result);
        } catch (fallbackErr) {
          reject(fallbackErr);
        }
      }
    });
  }

  return Promise.resolve(
    convertAudioToMath(clonedChannels, sampleRate, config, {
      name,
      isCancelled: () => cancelMainThreadFlag,
      onProgress,
    })
  );
}

const defaultInitialRecipe = BUILT_IN_EXAMPLES['ui-click']!;

export const useAudioStore = create<AudioStoreState>((set, get) => {
  const savedTheme =
    typeof localStorage !== 'undefined' ? localStorage.getItem('resonance_theme') : null;
  const initialTheme: 'light' | 'dark' =
    savedTheme === 'light' || savedTheme === 'dark'
      ? savedTheme
      : typeof window !== 'undefined' &&
          window.matchMedia &&
          window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';

  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', initialTheme);
  }

  const startBufferPlayback = (
    buffer: AudioBuffer,
    sourceKind: Exclude<PlaybackSource, null>,
    requestedOffset?: number
  ) => {
    get().stopPlayback(false);

    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    const offset =
      requestedOffset !== undefined && requestedOffset >= 0 && requestedOffset < buffer.duration - 0.01
        ? requestedOffset
        : 0;

    currentSourceNode = source;
    playbackStartCtxTime = ctx.currentTime;
    playbackStartOffset = offset;

    set({
      isPlaying: true,
      activePlaybackSource: sourceKind,
      currentTime: offset,
      playbackDuration: Math.max(
        buffer.duration,
        get().originalBuffer?.duration || 0,
        get().renderedProceduralBuffer?.duration || 0
      ),
    });

    const updateCursor = () => {
      if (currentSourceNode !== source) return;
      const elapsed = playbackStartOffset + (ctx.currentTime - playbackStartCtxTime);
      if (elapsed >= buffer.duration) {
        get().stopPlayback(true);
      } else {
        set({ currentTime: elapsed });
        animFrameId = requestAnimationFrame(updateCursor);
      }
    };
    animFrameId = requestAnimationFrame(updateCursor);

    source.onended = () => {
      if (currentSourceNode === source) {
        get().stopPlayback(true);
      }
    };

    source.start(0, offset);
  };

  return {
    theme: initialTheme,
    setTheme: (theme) => {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('resonance_theme', theme);
      }
      if (typeof document !== 'undefined') {
        document.documentElement.setAttribute('data-theme', theme);
      }
      set({ theme });
    },

    preset: 'balanced',
    setPreset: (preset) => {
      const presetDef = APP_CONFIG.presets[preset];
      set((state) => ({
        preset,
        reconstructionConfig: {
          ...state.reconstructionConfig,
          ...presetDef.config,
          mode: presetDef.mode,
        },
      }));
    },

    reconstructionConfig: { ...DEFAULT_RECONSTRUCTION_CONFIG },
    updateReconstructionConfig: (partial) =>
      set((state) => {
        const next = { ...state.reconstructionConfig, ...partial };
        // Keep windowSize <= fftSize and hopSize <= windowSize
        if (next.windowSize > next.fftSize) next.windowSize = next.fftSize;
        if (next.hopSize > next.windowSize) next.hopSize = Math.max(32, next.windowSize >> 1);
        if (next.minFrequency >= next.maxFrequency) {
          next.maxFrequency = Math.min(24000, next.minFrequency + 100);
        }
        return { reconstructionConfig: next };
      }),
    setReconstructionMode: (mode: ReconstructionMode) =>
      set((state) => {
        const defaultsForMode: Partial<ReconstructionConfig> =
          mode === 'exact'
            ? {
                mode: 'exact',
                preservePhase: true,
                minFrequency: 0,
                maxFrequency: 24000,
                fftSize: Math.min(2048, state.reconstructionConfig.fftSize),
                windowSize: Math.min(2048, state.reconstructionConfig.fftSize),
                hopSize: Math.min(2048, state.reconstructionConfig.fftSize) >> 1,
                compressionAggressiveness: 0,
              }
            : mode === 'procedural'
              ? {
                  mode: 'procedural',
                  maxOscillators: Math.min(12, state.reconstructionConfig.maxOscillators),
                }
              : {
                  mode: 'optimized',
                };
        return {
          reconstructionConfig: {
            ...state.reconstructionConfig,
            ...defaultsForMode,
          },
        };
      }),

    originalFileName: null,
    originalSizeBytes: 0,
    originalBuffer: null,
    originalChannels: null,
    originalAnalysis: null,
    originalWarning: null,
    isOriginalLoading: false,
    originalError: null,

    mathModel: null,
    reconstructedChannels: null,
    differenceBuffer: null,
    reconstructionMetrics: null,
    executionTimings: null,
    exportLanguage: 'js',
    setExportLanguage: (exportLanguage) => set({ exportLanguage }),

    recipe: defaultInitialRecipe,
    renderedProceduralBuffer: null,
    comparisonMetrics: null,
    isRenderingProcedural: false,
    isConverting: false,
    conversionProgress: 0,
    conversionStatusMessage: '',

    history: [defaultInitialRecipe],
    historyIndex: 0,

    isPlaying: false,
    activePlaybackSource: null,
    currentTime: 0,
    playbackDuration: defaultInitialRecipe.duration,
    zoom: 1,

    selectedLayerId: defaultInitialRecipe.layers[0]?.id || null,
    activeMainTab: 'editor',
    editorSubTab: 'layers',
    setEditorSubTab: (editorSubTab) => set({ editorSubTab }),
    isAboutModalOpen: false,

    loadAudioFromFile: async (file: File) => {
      set({ isOriginalLoading: true, originalError: null, originalWarning: null });
      get().stopPlayback(true);
      terminateActiveWorker();

      try {
        const audioCtx = getAudioContext();
        const loaded = await loadAndDecodeAudioFile(file, audioCtx);
        const analysis = analyzeAudioSamples(loaded.channels, loaded.buffer.sampleRate);

        const nyquist = Math.floor(loaded.buffer.sampleRate / 2);

        set((state) => ({
          originalFileName: loaded.fileName,
          originalSizeBytes: loaded.originalSizeBytes,
          originalBuffer: loaded.buffer,
          originalChannels: loaded.channels,
          originalAnalysis: analysis,
          originalWarning: loaded.warning ?? null,
          isOriginalLoading: false,
          mathModel: null,
          reconstructedChannels: null,
          differenceBuffer: null,
          reconstructionMetrics: null,
          executionTimings: null,
          editorSubTab: 'math',
          reconstructionConfig: {
            ...state.reconstructionConfig,
            maxFrequency: Math.min(state.reconstructionConfig.maxFrequency, nyquist),
          },
          playbackDuration: Math.max(loaded.buffer.duration, state.recipe.duration),
        }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load audio file.';
        set({ isOriginalLoading: false, originalError: message });
      }
    },

    clearOriginalAudio: () => {
      get().stopPlayback(true);
      terminateActiveWorker();
      set({
        originalFileName: null,
        originalSizeBytes: 0,
        originalBuffer: null,
        originalChannels: null,
        originalAnalysis: null,
        originalWarning: null,
        originalError: null,
        mathModel: null,
        reconstructedChannels: null,
        differenceBuffer: null,
        reconstructionMetrics: null,
        executionTimings: null,
        comparisonMetrics: null,
        isConverting: false,
      });
    },

    loadExampleRecipe: async (exampleKey: string) => {
      const ex = BUILT_IN_EXAMPLES[exampleKey];
      if (!ex) return;

      get().stopPlayback(true);
      set({ isRenderingProcedural: true });

      try {
        const rendered = await renderRecipeToBuffer(ex);
        const procAnalysis = analyzeAudioBuffer(rendered);
        const origAnalysis = get().originalAnalysis;
        const metrics = origAnalysis
          ? calculateApproximationScore(origAnalysis, procAnalysis)
          : null;

        set({
          recipe: ex,
          renderedProceduralBuffer: rendered,
          comparisonMetrics: metrics,
          isRenderingProcedural: false,
          selectedLayerId: ex.layers[0]?.id || null,
          editorSubTab: 'layers',
          playbackDuration: rendered.duration,
          currentTime: 0,
          history: [ex],
          historyIndex: 0,
        });
      } catch {
        set({ isRenderingProcedural: false });
      }
    },

    generateProceduralApproximation: async () => {
      const { originalChannels, originalBuffer, originalFileName, originalSizeBytes, reconstructionConfig } =
        get();

      if (!originalChannels || !originalBuffer) {
        set({ originalError: 'Please upload an audio file before running mathematical conversion.' });
        return;
      }

      get().stopPlayback(true);

      set({
        isConverting: true,
        originalError: null,
        conversionProgress: 0.05,
        conversionStatusMessage: `Starting ${reconstructionConfig.mode} reconstruction in Web Worker...`,
      });

      try {
        const soundName = (originalFileName || 'Audio').replace(/\.[^/.]+$/, '');
        const result = await runMathConversionInWorker(
          originalChannels,
          originalBuffer.sampleRate,
          reconstructionConfig,
          soundName,
          (progress, message) => {
            set({ conversionProgress: progress, conversionStatusMessage: message });
          }
        );

        const audioCtx = getAudioContext();
        const reconBuffer = createAudioBufferFromChannels(
          audioCtx,
          result.reconstructedChannels,
          result.sampleRate
        );
        const diffBuffer = createAudioBufferFromChannels(
          audioCtx,
          result.differenceChannels,
          result.sampleRate
        );

        // Sync editable procedural recipe when in procedural mode
        let nextRecipe = get().recipe;
        if (result.model.representation === 'procedural-math') {
          nextRecipe = proceduralModelToSoundRecipe(
            result.model,
            originalFileName ?? undefined,
            originalSizeBytes
          );
        }

        const compatComparison: ComparisonMetrics = {
          approximationScore: result.metrics.approximationScore,
          envelopeSimilarity: result.metrics.envelopeSimilarity,
          spectralSimilarity: result.metrics.spectralSimilarity,
          timbreSimilarity: result.metrics.timbreSimilarity,
          durationDifferenceSeconds: result.metrics.durationDifferenceSeconds,
          label: result.metrics.label,
        };

        set((state) => ({
          mathModel: result.model,
          reconstructedChannels: result.reconstructedChannels,
          renderedProceduralBuffer: reconBuffer,
          differenceBuffer: diffBuffer,
          reconstructionMetrics: result.metrics,
          comparisonMetrics: compatComparison,
          executionTimings: result.timings,
          recipe: nextRecipe,
          selectedLayerId: nextRecipe.layers[0]?.id || state.selectedLayerId,
          isConverting: false,
          conversionProgress: 1.0,
          conversionStatusMessage: `Complete (${result.timings.totalMs.toFixed(0)} ms)`,
          playbackDuration: Math.max(reconBuffer.duration, originalBuffer.duration),
          history:
            result.model.representation === 'procedural-math'
              ? [...state.history.slice(0, state.historyIndex + 1), nextRecipe]
              : state.history,
          historyIndex:
            result.model.representation === 'procedural-math'
              ? state.historyIndex + 1
              : state.historyIndex,
        }));
      } catch (err: unknown) {
        if (err instanceof Error && err.message === 'CANCELLED') {
          set({ isConverting: false, conversionStatusMessage: 'Cancelled' });
          return;
        }
        const message = err instanceof Error ? err.message : 'Error during mathematical reconstruction.';
        set({ isConverting: false, originalError: message });
      }
    },

    cancelConversion: () => {
      cancelMainThreadFlag = true;
      terminateActiveWorker();
      set({ isConverting: false, conversionStatusMessage: 'Cancelled', conversionProgress: 0 });
    },

    updateRecipe: async (updater, pushHistory = true) => {
      const newRecipe = updater(get().recipe);

      let newHistory = get().history;
      let newHistoryIndex = get().historyIndex;

      if (pushHistory) {
        newHistory = [...get().history.slice(0, get().historyIndex + 1), newRecipe];
        if (newHistory.length > 30) newHistory.shift();
        newHistoryIndex = newHistory.length - 1;
      }

      set({
        recipe: newRecipe,
        history: newHistory,
        historyIndex: newHistoryIndex,
        isRenderingProcedural: true,
      });

      try {
        const targetSr = get().originalBuffer?.sampleRate ?? 44100;
        const rendered = await renderRecipeToBuffer(newRecipe, targetSr, 0);
        const procChannels = extractAudioBufferChannels(rendered);
        const origChannels = get().originalChannels;
        const origBuffer = get().originalBuffer;

        if (origChannels && origBuffer) {
          const alignedOrig =
            origBuffer.sampleRate === rendered.sampleRate
              ? origChannels
              : resampleChannels(origChannels, origBuffer.sampleRate, rendered.sampleRate);
          const { metrics, differenceChannels } = compareAudioSignals(
            alignedOrig,
            procChannels,
            rendered.sampleRate
          );
          const diffBuf = createAudioBufferFromChannels(
            getAudioContext(),
            differenceChannels,
            rendered.sampleRate
          );
          set({
            renderedProceduralBuffer: rendered,
            reconstructedChannels: procChannels,
            differenceBuffer: diffBuf,
            reconstructionMetrics: metrics,
            comparisonMetrics: {
              approximationScore: metrics.approximationScore,
              envelopeSimilarity: metrics.envelopeSimilarity,
              spectralSimilarity: metrics.spectralSimilarity,
              timbreSimilarity: metrics.timbreSimilarity,
              durationDifferenceSeconds: metrics.durationDifferenceSeconds,
              label: metrics.label,
            },
            isRenderingProcedural: false,
            playbackDuration: Math.max(rendered.duration, origBuffer.duration),
          });
        } else {
          set({
            renderedProceduralBuffer: rendered,
            reconstructedChannels: procChannels,
            isRenderingProcedural: false,
            playbackDuration: rendered.duration,
          });
        }
      } catch {
        set({ isRenderingProcedural: false });
      }
    },

    undo: async () => {
      const { history, historyIndex } = get();
      if (historyIndex > 0) {
        const prevRecipe = history[historyIndex - 1]!;
        set({ historyIndex: historyIndex - 1 });
        await get().updateRecipe(() => prevRecipe, false);
      }
    },

    redo: async () => {
      const { history, historyIndex } = get();
      if (historyIndex < history.length - 1) {
        const nextRecipe = history[historyIndex + 1]!;
        set({ historyIndex: historyIndex + 1 });
        await get().updateRecipe(() => nextRecipe, false);
      }
    },

    addLayer: () => {
      const newLayer: SoundLayer = {
        id: `layer-${Date.now()}`,
        name: `Layer ${get().recipe.layers.length + 1}`,
        enabled: true,
        solo: false,
        oscillatorType: 'sine',
        startTime: 0,
        duration: Math.min(0.25, get().recipe.duration),
        gain: 0.7,
        pan: 0,
        startFrequency: 440,
        endFrequency: 440,
        frequencyCurve: 'constant',
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.1, release: 0.05 },
        lowPassFilter: { enabled: false, cutoff: 8000, q: 1 },
        highPassFilter: { enabled: false, cutoff: 40, q: 0.7 },
        distortion: { enabled: false, amount: 0 },
        delay: { enabled: false, time: 0.05, feedback: 0.2, mix: 0 },
        frequencyModulation: { enabled: false, modFrequency: 60, modDepth: 0 },
        seed: Math.floor(Math.random() * 10000),
      };

      void get().updateRecipe((prev) => ({
        ...prev,
        layers: [...prev.layers, newLayer],
      }));
      set({ selectedLayerId: newLayer.id });
    },

    duplicateLayer: (layerId: string) => {
      const target = get().recipe.layers.find((l) => l.id === layerId);
      if (!target) return;

      const dup: SoundLayer = {
        ...(JSON.parse(JSON.stringify(target)) as SoundLayer),
        id: `layer-${Date.now()}`,
        name: `${target.name} (Copy)`,
      };

      void get().updateRecipe((prev) => ({
        ...prev,
        layers: [...prev.layers, dup],
      }));
      set({ selectedLayerId: dup.id });
    },

    deleteLayer: (layerId: string) => {
      void get().updateRecipe((prev) => ({
        ...prev,
        layers: prev.layers.filter((l) => l.id !== layerId),
      }));
      if (get().selectedLayerId === layerId) {
        set({ selectedLayerId: get().recipe.layers[0]?.id || null });
      }
    },

    toggleLayerEnabled: (layerId: string) => {
      void get().updateRecipe((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === layerId ? { ...l, enabled: !l.enabled } : l)),
      }));
    },

    toggleLayerSolo: (layerId: string) => {
      void get().updateRecipe((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === layerId ? { ...l, solo: !l.solo } : l)),
      }));
    },

    reorderLayers: (startIndex: number, endIndex: number) => {
      void get().updateRecipe((prev) => {
        const layers = [...prev.layers];
        const [moved] = layers.splice(startIndex, 1);
        if (moved) layers.splice(endIndex, 0, moved);
        return { ...prev, layers };
      });
    },

    updateLayer: (layerId: string, partial: Partial<SoundLayer>) => {
      void get().updateRecipe((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === layerId ? { ...l, ...partial } : l)),
      }));
    },

    setSelectedLayerId: (selectedLayerId) => set({ selectedLayerId }),
    setActiveMainTab: (activeMainTab) => set({ activeMainTab }),
    setIsAboutModalOpen: (isAboutModalOpen) => set({ isAboutModalOpen }),
    setZoom: (zoom) => set({ zoom }),

    playOriginal: async (fromTime?: number) => {
      const buffer = get().originalBuffer;
      if (!buffer) return;
      startBufferPlayback(buffer, 'original', fromTime ?? get().currentTime);
    },

    playProcedural: async (fromTime?: number) => {
      let buffer = get().renderedProceduralBuffer;
      if (!buffer) {
        buffer = await renderRecipeToBuffer(get().recipe);
        set({ renderedProceduralBuffer: buffer });
      }
      startBufferPlayback(buffer, 'procedural', fromTime ?? get().currentTime);
    },

    playDifference: async (fromTime?: number) => {
      const buffer = get().differenceBuffer;
      if (!buffer) return;
      startBufferPlayback(buffer, 'difference', fromTime ?? get().currentTime);
    },

    stopPlayback: (resetCursor = true) => {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = 0;
      }
      if (currentSourceNode) {
        const node = currentSourceNode;
        currentSourceNode = null;
        node.onended = null;
        try {
          node.stop();
          node.disconnect();
        } catch {
          // Ignore if already stopped
        }
      }
      set((state) => ({
        isPlaying: false,
        activePlaybackSource: null,
        currentTime: resetCursor ? 0 : state.currentTime,
      }));
    },

    toggleABPlayback: async () => {
      const { activePlaybackSource, currentTime, isPlaying, originalBuffer } = get();
      // Preserve synchronized playback cursor across A/B switches!
      const resumePos = isPlaying ? currentTime : 0;
      if (activePlaybackSource === 'original') {
        await get().playProcedural(resumePos);
      } else if (originalBuffer) {
        await get().playOriginal(resumePos);
      } else {
        await get().playProcedural(resumePos);
      }
    },

    seek: (seconds: number) => {
      const target = Math.max(0, seconds);
      const { isPlaying, activePlaybackSource } = get();
      set({ currentTime: target });
      if (isPlaying && activePlaybackSource === 'original') {
        void get().playOriginal(target);
      } else if (isPlaying && activePlaybackSource === 'procedural') {
        void get().playProcedural(target);
      } else if (isPlaying && activePlaybackSource === 'difference') {
        void get().playDifference(target);
      }
    },
  };
});
