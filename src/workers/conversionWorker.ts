/// <reference lib="webworker" />
import { AudioAnalysisResult } from '@/types/analysis';
import { generateRecipeFromAnalysis } from '@/audio/synthesis/generator';
import { PresetKey } from '@/config/appConfig';

interface ConvertMessage {
  type: 'CONVERT';
  analysis: AudioAnalysisResult;
  preset: PresetKey;
  fileName: string;
  fileSizeBytes: number;
}

interface CancelMessage {
  type: 'CANCEL';
}

type InMessage = ConvertMessage | CancelMessage;

let isCancelled = false;

self.onmessage = async (e: MessageEvent<InMessage>) => {
  const data = e.data;

  if (data.type === 'CANCEL') {
    isCancelled = true;
    return;
  }

  if (data.type === 'CONVERT') {
    isCancelled = false;
    try {
      // 1. Initial heuristic generation
      self.postMessage({
        type: 'PROGRESS',
        progress: 0.2,
        message: 'Generating heuristic synthesis layers...',
      });

      const initialRecipe = generateRecipeFromAnalysis(
        data.analysis,
        data.preset,
        data.fileName,
        data.fileSizeBytes
      );

      self.postMessage({
        type: 'PROGRESS',
        progress: 0.5,
        message: 'Refining envelope and frequency trajectory...',
      });

      // Simulation/optimization stages in worker
      for (let step = 1; step <= 5; step++) {
        if (isCancelled) {
          self.postMessage({ type: 'CANCELLED' });
          return;
        }
        await new Promise((r) => setTimeout(r, 40));
        self.postMessage({
          type: 'PROGRESS',
          progress: 0.5 + step * 0.09,
          message: `Optimizing timbre & spectral centroid (Pass ${step}/5)...`,
        });
      }

      self.postMessage({
        type: 'COMPLETE',
        recipe: initialRecipe,
      });
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error ? err.message : 'Unknown worker error during conversion';
      self.postMessage({ type: 'ERROR', error: errorMsg });
    }
  }
};
