import { create } from 'zustand';
import { SoundRecipe, SoundLayer } from '@/types/recipe';
import { AudioAnalysisResult } from '@/types/analysis';
import { PresetKey, APP_CONFIG } from '@/config/appConfig';
import { ComparisonMetrics, calculateApproximationScore } from '@/audio/comparison/comparator';
import { BUILT_IN_EXAMPLES } from '@/examples/builtInExamples';
import { renderRecipeToBuffer } from '@/audio/rendering/renderer';
import { analyzeAudioBuffer } from '@/audio/analysis/analyzer';
import { loadAndDecodeAudioFile } from '@/audio/analysis/audioLoader';
import { generateRecipeFromAnalysis } from '@/audio/synthesis/generator';
import { optimizeRecipe } from '@/audio/synthesis/optimizer';

export interface AudioStoreState {
  // Theme
  theme: 'light' | 'dark';
  setTheme: (theme: 'light' | 'dark') => void;

  // Preset
  preset: PresetKey;
  setPreset: (preset: PresetKey) => void;

  // Original Audio
  originalFileName: string | null;
  originalSizeBytes: number;
  originalBuffer: AudioBuffer | null;
  originalAnalysis: AudioAnalysisResult | null;
  isOriginalLoading: boolean;
  originalError: string | null;

  // Procedural Recipe & Rendering
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
  activePlaybackSource: 'original' | 'procedural' | null;
  currentTime: number;
  playbackDuration: number;
  isABModeActive: boolean;
  zoom: number;

  // UI Selection
  selectedLayerId: string | null;
  activeMainTab: 'editor' | 'comparison' | 'export';
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
  playOriginal: () => Promise<void>;
  playProcedural: () => Promise<void>;
  stopPlayback: () => void;
  toggleABPlayback: () => Promise<void>;
  seek: (seconds: number) => void;
}

// Global AudioContext management
let globalAudioContext: AudioContext | null = null;
let currentSourceNode: AudioBufferSourceNode | null = null;
let playbackStartTime = 0;
let animFrameId = 0;
let cancelOptimizationFlag = false;

function getAudioContext(): AudioContext {
  if (!globalAudioContext) {
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    globalAudioContext = new AudioContextClass();
  }
  if (globalAudioContext.state === 'suspended') {
    globalAudioContext.resume();
  }
  return globalAudioContext;
}

// Initial default recipe (UI Click)
const defaultInitialRecipe = BUILT_IN_EXAMPLES['ui-click']!;

export const useAudioStore = create<AudioStoreState>((set, get) => {
  // Read initial theme preference from localStorage or system preference
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

  // Apply initial theme to documentElement
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', initialTheme);
  }

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
    setPreset: (preset) => set({ preset }),

    originalFileName: null,
    originalSizeBytes: 0,
    originalBuffer: null,
    originalAnalysis: null,
    isOriginalLoading: false,
    originalError: null,

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
    isABModeActive: false,
    zoom: 1,

    selectedLayerId: defaultInitialRecipe.layers[0]?.id || null,
    activeMainTab: 'editor',
    isAboutModalOpen: false,

    loadAudioFromFile: async (file: File) => {
      set({ isOriginalLoading: true, originalError: null });
      get().stopPlayback();

      try {
        const audioCtx = getAudioContext();
        const loaded = await loadAndDecodeAudioFile(file, audioCtx);
        const analysis = analyzeAudioBuffer(loaded.buffer);

        set({
          originalFileName: loaded.fileName,
          originalSizeBytes: loaded.originalSizeBytes,
          originalBuffer: loaded.buffer,
          originalAnalysis: analysis,
          isOriginalLoading: false,
          playbackDuration: Math.max(loaded.buffer.duration, get().recipe.duration),
        });

        // If procedural buffer is already rendered, update comparison metrics
        const procBuffer = get().renderedProceduralBuffer;
        if (procBuffer) {
          const procAnalysis = analyzeAudioBuffer(procBuffer);
          const metrics = calculateApproximationScore(analysis, procAnalysis);
          set({ comparisonMetrics: metrics });
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to load audio file.';
        set({ isOriginalLoading: false, originalError: message });
      }
    },

    clearOriginalAudio: () => {
      get().stopPlayback();
      set({
        originalFileName: null,
        originalSizeBytes: 0,
        originalBuffer: null,
        originalAnalysis: null,
        originalError: null,
        comparisonMetrics: null,
      });
    },

    loadExampleRecipe: async (exampleKey: string) => {
      const ex = BUILT_IN_EXAMPLES[exampleKey];
      if (!ex) return;

      get().stopPlayback();

      // Render procedural buffer
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
      const origAnalysis = get().originalAnalysis;
      if (!origAnalysis) {
        set({ originalError: 'Please upload or record audio before generating procedural sound.' });
        return;
      }

      get().stopPlayback();
      cancelOptimizationFlag = false;

      set({
        isConverting: true,
        conversionProgress: 0.1,
        conversionStatusMessage: 'Analyzing frequency spectrum and onset dynamics...',
      });

      try {
        const preset = get().preset;
        const initialRecipe = generateRecipeFromAnalysis(
          origAnalysis,
          preset,
          get().originalFileName || 'Audio',
          get().originalSizeBytes
        );

        set({
          conversionProgress: 0.35,
          conversionStatusMessage: 'Running deterministic heuristic optimization...',
        });

        const optIterations = APP_CONFIG.presets[preset].optimizationIterations;

        const optResult = await optimizeRecipe(initialRecipe, origAnalysis, {
          maxIterations: optIterations,
          isCancelled: () => cancelOptimizationFlag,
          onProgress: (prog, score) => {
            set({
              conversionProgress: 0.35 + prog * 0.55,
              conversionStatusMessage: `Refining parameter convergence (${score}% approx)...`,
            });
          },
        });

        const finalRecipe = optResult.optimizedRecipe;
        const finalBuffer = await renderRecipeToBuffer(finalRecipe);

        set((state) => ({
          recipe: finalRecipe,
          renderedProceduralBuffer: finalBuffer,
          comparisonMetrics: optResult.metrics,
          isConverting: false,
          conversionProgress: 1.0,
          conversionStatusMessage: 'Complete',
          selectedLayerId: finalRecipe.layers[0]?.id || null,
          history: [...state.history.slice(0, state.historyIndex + 1), finalRecipe],
          historyIndex: state.historyIndex + 1,
          playbackDuration: Math.max(finalBuffer.duration, state.originalBuffer?.duration || 0),
        }));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Error generating procedural audio.';
        set({ isConverting: false, originalError: message });
      }
    },

    cancelConversion: () => {
      cancelOptimizationFlag = true;
      set({ isConverting: false, conversionStatusMessage: 'Cancelled' });
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
        const rendered = await renderRecipeToBuffer(newRecipe);
        const procAnalysis = analyzeAudioBuffer(rendered);
        const origAnalysis = get().originalAnalysis;
        const metrics = origAnalysis
          ? calculateApproximationScore(origAnalysis, procAnalysis)
          : null;

        set({
          renderedProceduralBuffer: rendered,
          comparisonMetrics: metrics,
          isRenderingProcedural: false,
          playbackDuration: Math.max(rendered.duration, get().originalBuffer?.duration || 0),
        });
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

      get().updateRecipe((prev) => ({
        ...prev,
        layers: [...prev.layers, newLayer],
      }));
      set({ selectedLayerId: newLayer.id });
    },

    duplicateLayer: (layerId: string) => {
      const target = get().recipe.layers.find((l) => l.id === layerId);
      if (!target) return;

      const dup: SoundLayer = {
        ...JSON.parse(JSON.stringify(target)),
        id: `layer-${Date.now()}`,
        name: `${target.name} (Copy)`,
      };

      get().updateRecipe((prev) => ({
        ...prev,
        layers: [...prev.layers, dup],
      }));
      set({ selectedLayerId: dup.id });
    },

    deleteLayer: (layerId: string) => {
      get().updateRecipe((prev) => ({
        ...prev,
        layers: prev.layers.filter((l) => l.id !== layerId),
      }));
      if (get().selectedLayerId === layerId) {
        set({ selectedLayerId: get().recipe.layers[0]?.id || null });
      }
    },

    toggleLayerEnabled: (layerId: string) => {
      get().updateRecipe((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === layerId ? { ...l, enabled: !l.enabled } : l)),
      }));
    },

    toggleLayerSolo: (layerId: string) => {
      get().updateRecipe((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === layerId ? { ...l, solo: !l.solo } : l)),
      }));
    },

    reorderLayers: (startIndex: number, endIndex: number) => {
      get().updateRecipe((prev) => {
        const layers = [...prev.layers];
        const [moved] = layers.splice(startIndex, 1);
        if (moved) layers.splice(endIndex, 0, moved);
        return { ...prev, layers };
      });
    },

    updateLayer: (layerId: string, partial: Partial<SoundLayer>) => {
      get().updateRecipe((prev) => ({
        ...prev,
        layers: prev.layers.map((l) => (l.id === layerId ? { ...l, ...partial } : l)),
      }));
    },

    setSelectedLayerId: (selectedLayerId) => set({ selectedLayerId }),
    setActiveMainTab: (activeMainTab) => set({ activeMainTab }),
    setIsAboutModalOpen: (isAboutModalOpen) => set({ isAboutModalOpen }),
    setZoom: (zoom) => set({ zoom }),

    playOriginal: async () => {
      const buffer = get().originalBuffer;
      if (!buffer) return;
      get().stopPlayback();

      const ctx = getAudioContext();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      currentSourceNode = source;
      playbackStartTime = ctx.currentTime;

      set({
        isPlaying: true,
        activePlaybackSource: 'original',
        playbackDuration: buffer.duration,
      });

      const updateCursor = () => {
        const elapsed = ctx.currentTime - playbackStartTime;
        if (elapsed >= buffer.duration) {
          get().stopPlayback();
        } else {
          set({ currentTime: elapsed });
          animFrameId = requestAnimationFrame(updateCursor);
        }
      };
      animFrameId = requestAnimationFrame(updateCursor);

      source.start(0);
      source.onended = () => {
        if (get().activePlaybackSource === 'original') {
          get().stopPlayback();
        }
      };
    },

    playProcedural: async () => {
      // If rendered buffer is ready, play it; otherwise render it first
      let buffer = get().renderedProceduralBuffer;
      if (!buffer) {
        buffer = await renderRecipeToBuffer(get().recipe);
        set({ renderedProceduralBuffer: buffer });
      }

      get().stopPlayback();

      const ctx = getAudioContext();
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      currentSourceNode = source;
      playbackStartTime = ctx.currentTime;

      set({
        isPlaying: true,
        activePlaybackSource: 'procedural',
        playbackDuration: buffer.duration,
      });

      const updateCursor = () => {
        const elapsed = ctx.currentTime - playbackStartTime;
        if (elapsed >= buffer.duration) {
          get().stopPlayback();
        } else {
          set({ currentTime: elapsed });
          animFrameId = requestAnimationFrame(updateCursor);
        }
      };
      animFrameId = requestAnimationFrame(updateCursor);

      source.start(0);
      source.onended = () => {
        if (get().activePlaybackSource === 'procedural') {
          get().stopPlayback();
        }
      };
    },

    stopPlayback: () => {
      if (animFrameId) {
        cancelAnimationFrame(animFrameId);
        animFrameId = 0;
      }
      if (currentSourceNode) {
        try {
          currentSourceNode.stop();
          currentSourceNode.disconnect();
        } catch {
          // Ignore if already stopped
        }
        currentSourceNode = null;
      }
      set({ isPlaying: false, activePlaybackSource: null, currentTime: 0 });
    },

    toggleABPlayback: async () => {
      const active = get().activePlaybackSource;
      if (active === 'original') {
        await get().playProcedural();
      } else {
        if (get().originalBuffer) {
          await get().playOriginal();
        } else {
          await get().playProcedural();
        }
      }
    },

    seek: (seconds: number) => {
      set({ currentTime: Math.max(0, seconds) });
    },
  };
});
