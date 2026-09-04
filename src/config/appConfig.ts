export const APP_CONFIG = {
  name: 'Resonance SFX',
  tagline: 'Procedural Game Sound Approximator',
  version: '0.1.0',
  description:
    'Convert short uploaded game sound effects into compact, editable, deterministic Web Audio procedural recipes.',
  privacyNotice: 'Your audio is processed locally in this browser and is not uploaded.',
  limits: {
    maxDurationSeconds: 3.0,
    maxFileSizeBytes: 10 * 1024 * 1024, // 10 MB
    supportedFormats: [
      'audio/wav',
      'audio/mpeg',
      'audio/ogg',
      'audio/webm',
      'audio/x-wav',
      'audio/mp3',
    ],
  },
  presets: {
    tiny: {
      id: 'tiny',
      label: 'Tiny',
      description: 'Maximum size reduction (~1-2 layers, minimal modulation).',
      maxLayers: 2,
      optimizationIterations: 20,
      allowEffects: false,
    },
    balanced: {
      id: 'balanced',
      label: 'Balanced',
      description: 'Default balance of fidelity and size (~2-3 layers with filtering).',
      maxLayers: 3,
      optimizationIterations: 45,
      allowEffects: true,
    },
    accurate: {
      id: 'accurate',
      label: 'Accurate',
      description:
        'Higher procedural approximation fidelity (~3-5 layers, pitch sweeps & saturation).',
      maxLayers: 5,
      optimizationIterations: 80,
      allowEffects: true,
    },
  },
} as const;

export type PresetKey = keyof typeof APP_CONFIG.presets;
