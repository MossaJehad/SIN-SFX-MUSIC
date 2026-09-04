# Resonance SFX

> A local-first web application that converts short uploaded game sound effects into compact, editable, deterministic procedural audio recipes.

Inspired by the visual design language of **Mozilla Firefox’s Acorn Design System**, Resonance SFX operates entirely in the browser using the Web Audio API and `OfflineAudioContext`. It analyzes transient and harmonic characteristics of game audio and builds lightweight procedural recipes using multi-layer oscillators, noise, envelopes, filters, saturation, and effects.

---

## Features

- **100% Local-First & Private**: Audio never leaves the browser. No cloud AI, backend servers, databases, or tracking telemetry.
- **Deterministic DSP Analysis**:
  - Extracts Peak amplitude, RMS loudness, and continuous amplitude envelope.
  - Computes Zero-Crossing Rate (ZCR) and Fast Fourier Transform (FFT) spectral centroid.
  - Estimates dominant pitch trajectories over time.
  - Evaluates tonal-versus-noisy ratio via Wiener entropy / spectral flatness.
  - Automatically classifies input sound effects into **tonal**, **percussive**, **noisy**, or **mixed**.
- **Multi-Layer Procedural Synthesis Engine**:
  - Waveforms: `sine`, `triangle`, `square`, `sawtooth`, `noise` (white and pink PRNG noise).
  - Deterministic Mulberry32 seeded pseudo-random noise generator.
  - Parameterized ADSR amplitude envelope.
  - Frequency sweep automation (`constant`, `linear`, `exponential`).
  - Low-pass and High-pass resonant biquad filters.
  - Hyperbolic tangent soft-saturation / waveshaping distortion.
  - Feedback delay line and Frequency Modulation (FM).
  - Stereo panning and dynamics soft limiter to prevent clipping.
- **Heuristic Conversion & Multi-Pass Optimization**:
  - Non-blocking analysis and iterative parameter tuning.
  - Cancellation support with live progress updates.
  - Calculates a clearly labeled **Approximation score** (comparing normalized envelope contour, spectral centroid brightness, and zero-crossing distributions).
- **Manual Procedural Editor**:
  - Layer list: Add, duplicate, delete, mute, solo, and reorder layers.
  - Continuous range sliders plus exact numeric input fields with engineering units (Hz, ms, s, %, gain).
  - Parameter reset buttons for every setting.
  - Full Undo / Redo history with keyboard shortcuts (`Ctrl+Z`, `Ctrl+Y`).
  - Immediate preview playback and real-time offline re-rendering.
- **Waveform Comparison**:
  - Authentic dual waveform rendering using decoded and rendered audio sample peaks.
  - Shared timeline and scale.
  - Instantaneous A/B toggle playback.
  - Synchronized playhead cursor and zoom controls (1x, 2x, 4x).
- **Honest Footprint & Savings Breakdown**:
  - Presets: **Tiny**, **Balanced**, **Accurate**.
  - Compares original asset size against procedural JSON, standalone runtime size, total first-use bundle size, and additional sound cost.
  - Honestly reports when a procedural representation is larger than a tiny original asset.
- **Multi-Format Export**:
  - Readable `.sfx.json` recipe.
  - Minified `.min.sfx.json`.
  - Standalone, zero-dependency JavaScript module (`playSound(audioContext, options)`).
  - Standalone typed TypeScript module.
  - 16-bit PCM WAV audio file rendered via `OfflineAudioContext`.
  - Complete runtime package (player, types, example, license, README).
- **Built-in Procedural Examples** (no bundled audio files required):
  - UI Click
  - Coin Pickup
  - Laser
  - Jump
  - Hit
  - Small Explosion
- **Accessibility & Themes**:
  - Keyboard accessible controls and focus rings.
  - High-contrast light and dark mode toggles powered by Acorn tokens.
  - Reduced-motion support (`prefers-reduced-motion`).
  - Responsive layout (3-column desktop workspace, tablet tabbed navigation, stacked mobile view).

---

## What It Does NOT Do (MVP Limitations)

- **Not Lossless Compression**: The generated procedural result is an approximation designed to recreate the aesthetic feel of game sound effects with minimal code footprint.
- **No Music or Speech Conversion**: The DSP algorithms are specifically tuned for short, non-polyphonic game sound effects (maximum duration: 3.0 seconds, maximum file size: 10 MB).
- **No Source Separation**: Does not separate vocals or multi-instrument stems.
- **No Cloud Accounts or Billing**: Pure client-side tool.

---

## How Procedural Audio Works

Procedural audio synthesizes sounds in real-time from mathematical rules and signal processing graphs rather than streaming pre-recorded audio sample files:

1. **Oscillators & Noise**: Fundamental tones are generated using basic geometric waveforms (sine, triangle, square, saw) or deterministic pseudo-random noise.
2. **Pitch Automation**: Frequency sweeps create motion (e.g. exponential downward sweep for a laser or fast exponential rise for a jump).
3. **Amplitude Shaping**: Attack, Decay, Sustain, and Release (ADSR) stages sculpt the temporal volume dynamics.
4. **Spectral Filtering & Saturation**: Low-pass/high-pass filters and non-linear waveshaping add warmth, punch, resonance, and body.
5. **Deterministic Seed**: The Mulberry32 algorithm ensures that procedural noise buffers produce identical sound across different platforms and sessions.

---

## Project Architecture

```
src/
├── audio/
│   ├── analysis/
│   │   ├── analyzer.ts          # Feature extraction (peak, RMS, ZCR, centroid, flatness)
│   │   ├── audioLoader.ts       # Browser file decoding and validation (<3s, <10MB)
│   │   └── fft.ts               # Lightweight Radix-2 Cooley-Tukey FFT implementation
│   ├── comparison/
│   │   └── comparator.ts        # Algorithmic approximation score calculation
│   ├── export/
│   │   ├── codeGenerators.ts    # Standalone JS/TS modules and JSON exporter
│   │   ├── sizeCalculator.ts    # Honest byte size and synthesis cost calculator
│   │   └── wav.ts               # 16-bit PCM WAV binary encoder
│   ├── rendering/
│   │   └── renderer.ts          # OfflineAudioContext procedural buffer renderer
│   └── synthesis/
│       ├── distortion.ts        # Waveshaper transfer curve generator
│       ├── generator.ts         # Heuristic recipe generator
│       ├── graph.ts             # Web Audio node pipeline builder
│       ├── noise.ts             # Deterministic Mulberry32 PRNG & noise buffer
│       ├── optimizer.ts         # Multi-pass parameter perturbation optimizer
│       └── validation.ts        # Central recipe schema validator
├── components/
│   ├── AboutModal.tsx           # Help and privacy information dialog
│   ├── Header.tsx               # Top toolbar with branding, actions, presets
│   ├── PrivacyBanner.tsx        # Local-first privacy notice banner
│   └── WaveformCanvas.tsx       # Real audio buffer waveform visualizer with scrub cursor
├── config/
│   └── appConfig.ts             # Central application configuration, presets, and limits
├── design-system/
│   ├── icons/
│   │   ├── AcornIcon.tsx        # Official Firefox Acorn geometric SVG icons
│   │   └── LICENSE.md           # MPL-2.0 license notice
│   ├── Badge.tsx
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── Dialog.tsx
│   ├── ProgressBar.tsx
│   ├── Select.tsx
│   ├── SliderWithInput.tsx      # Slider + numeric input + unit + reset control
│   ├── Tabs.tsx                 # WAI-ARIA accessible tabs
│   └── tokens.css               # Mozilla Acorn design tokens (colors, radii, focus, typography)
├── examples/
│   └── builtInExamples.ts       # 6 procedural game sound effect presets
├── features/
│   └── editor/
│       ├── LayerEditor.tsx      # Comprehensive parameter editor
│       ├── LayerList.tsx        # Layer management (add, delete, solo, mute, reorder, undo/redo)
│       ├── OriginalAudioPanel.tsx
│       ├── ProceduralEditorPanel.tsx
│       ├── QualityAndExportPanel.tsx
│       ├── WaveformComparisonPanel.tsx
│       └── useAudioStore.ts     # Zustand application state management
├── types/
│   ├── analysis.ts              # Analysis metrics and classification types
│   └── recipe.ts                # Central procedural SoundRecipe TypeScript schema
└── workers/
    └── conversionWorker.ts      # Web Worker for non-blocking heuristic processing
```

---

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- npm >= 9.0.0

### Installation

```bash
# Install dependencies
npm install
```

### Running Locally

```bash
# Start Vite development server
npm run dev
```

Open `http://localhost:5173` in your browser.

### Building for Production

```bash
# Run TypeScript type check and production build
npm run build

# Preview production build locally
npm run preview
```

---

## Testing

### Unit Tests (Vitest)

Unit tests cover recipe validation, PRNG determinism, distortion curves, FFT and audio analysis, WAV encoding, size calculations, and envelope comparison.

```bash
npm test
```

### End-to-End Tests (Playwright)

End-to-end tests verify key user journeys:

1. Loading built-in examples.
2. Playing procedural audio.
3. Uploading audio files and validating limits.
4. Generating procedural approximations.
5. Editing synthesis parameters.
6. Exporting JSON recipes.
7. Switching light and dark themes.

```bash
npm run test:e2e
```

### Linting & Formatting

```bash
npm run lint
npm run format:check
```

---

## Export Formats

| Format              | Extension       | Description                                          | Typical Size |
| ------------------- | --------------- | ---------------------------------------------------- | ------------ |
| **JSON Recipe**     | `.sfx.json`     | Fully-typed, human-readable sound specification      | ~1.2 KB      |
| **Minified JSON**   | `.min.sfx.json` | Compact serialized recipe                            | ~0.7 KB      |
| **JavaScript**      | `.player.js`    | Zero-dependency standalone ES module (`playSound()`) | ~2.5 KB      |
| **TypeScript**      | `.player.ts`    | Fully-typed standalone TypeScript module             | ~2.7 KB      |
| **WAV Audio**       | `.wav`          | Standard 16-bit uncompressed PCM audio render        | ~20 - 80 KB  |
| **Runtime Package** | Bundle          | Standalone player, types, recipe, and README         | ~4.5 KB      |

---

## Future Improvements

- Additional synthesis algorithms: Karplus-Strong plucked string synthesis, subtractive resonant sweeps, and granular textures.
- WebAssembly-accelerated SIMD FFT for large batch conversions.
- Direct export targets for Godot 4 AudioStreamGenerator and Unity procedural audio scripts.
- Microtonal frequency tuning and custom user envelope curve handles.

---

## License

- Application source code is available under the **MIT License**.
- Iconography is derived from [FirefoxUX/acorn-icons](https://github.com/FirefoxUX/acorn-icons) and is licensed under the **Mozilla Public License Version 2.0 (MPL-2.0)**.
