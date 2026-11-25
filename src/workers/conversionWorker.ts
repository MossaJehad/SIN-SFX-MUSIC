/// <reference lib="webworker" />
import { ReconstructionConfig } from '@/types/mathModel';
import { convertAudioToMath } from '@/audio/math/mathPipeline';

export interface WorkerConvertRequest {
  type: 'CONVERT_MATH';
  jobId: number;
  channels: Float32Array[];
  sampleRate: number;
  config: ReconstructionConfig;
  name: string;
}

export interface WorkerCancelRequest {
  type: 'CANCEL';
  jobId?: number;
}

export type WorkerInMessage = WorkerConvertRequest | WorkerCancelRequest;

let cancelledJobId = -1;

self.onmessage = (e: MessageEvent<WorkerInMessage>) => {
  const msg = e.data;

  if (msg.type === 'CANCEL') {
    cancelledJobId = msg.jobId ?? Number.MAX_SAFE_INTEGER;
    return;
  }

  if (msg.type === 'CONVERT_MATH') {
    const { jobId, channels, sampleRate, config, name } = msg;
    const isCancelled = () => cancelledJobId >= jobId;

    try {
      const result = convertAudioToMath(channels, sampleRate, config, {
        name,
        isCancelled,
        onProgress: (progress, stage) => {
          if (!isCancelled()) {
            self.postMessage({
              type: 'PROGRESS',
              jobId,
              progress,
              message: stage,
            });
          }
        },
      });

      if (isCancelled()) {
        self.postMessage({ type: 'CANCELLED', jobId });
        return;
      }

      // Transfer reconstructed and difference ArrayBuffers zero-copy back to main thread
      const transferables: Transferable[] = [
        ...result.reconstructedChannels.map((c) => c.buffer),
        ...result.differenceChannels.map((c) => c.buffer),
        result.metrics.spectrum.frequencies.buffer,
        result.metrics.spectrum.originalDb.buffer,
        result.metrics.spectrum.reconstructedDb.buffer,
        result.metrics.spectrogram.originalDb.buffer,
        result.metrics.spectrogram.reconstructedDb.buffer,
      ];

      self.postMessage(
        {
          type: 'COMPLETE',
          jobId,
          result,
        },
        transferables
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message === 'CANCELLED') {
        self.postMessage({ type: 'CANCELLED', jobId });
        return;
      }
      const errorMsg =
        err instanceof Error ? err.message : 'Unknown worker error during mathematical conversion';
      self.postMessage({ type: 'ERROR', jobId, error: errorMsg });
    }
  }
};
