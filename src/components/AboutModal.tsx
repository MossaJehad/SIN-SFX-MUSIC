import React from 'react';
import { useAudioStore } from '@/features/editor/useAudioStore';
import { Dialog } from '@/design-system/Dialog';
import { Button } from '@/design-system/Button';
import { APP_CONFIG } from '@/config/appConfig';

export const AboutModal: React.FC = () => {
  const { isAboutModalOpen, setIsAboutModalOpen } = useAudioStore();

  return (
    <Dialog
      isOpen={isAboutModalOpen}
      title={`About ${APP_CONFIG.name}`}
      onClose={() => setIsAboutModalOpen(false)}
      footer={
        <Button variant="primary" size="sm" onClick={() => setIsAboutModalOpen(false)}>
          Close
        </Button>
      }
      maxWidth="640px"
    >
      <div
        className="about-modal-content"
        style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <section>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600 }}>
            Genuine Audio-to-Math Sinusoidal Converter
          </h4>
          <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5 }}>
            {APP_CONFIG.name} converts uploaded audio files (WAV, MP3, OGG, WebM, FLAC) into
            standalone mathematical representations of the form{' '}
            <code>S(t) = Σ A[n] · sin(2π · f[n] · t + φ[n])</code>. Reconstructed audio is
            synthesized exclusively from those mathematical parameters without embedding original
            audio or raw PCM arrays.
          </p>
        </section>

        <section>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600 }}>
            Three Reconstruction Modes & Honest Trade-offs
          </h4>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.5 }}>
            <li>
              <strong>Exact Reconstruction:</strong> Retains all STFT Fourier sinusoidal
              coefficients (including DC, Nyquist, and exact phase) with COLA overlap-add. Achieves
              numerical-precision reconstruction (SNR &gt; 120 dB), but usually requires{' '}
              <strong>more storage</strong> than compressed MP3/OGG or 16-bit WAV.
            </li>
            <li>
              <strong>Optimized Reconstruction:</strong> Uses McAulay-Quatieri zero-phase
              sinusoidal track resynthesis (with cubic phase continuity) or sparse STFT pruning plus
              optional deterministic residual noise to balance fidelity, transients, and size.
            </li>
            <li>
              <strong>Procedural Reconstruction:</strong> Fits compact closed-form analytical
              functions (sine waves, frequency sweeps, FM/AM, exponential envelopes) via orthogonal
              projection. Smallest output size, clearly labeled as an approximation — broadband
              explosions and complex environmental sounds cannot be represented losslessly with only
              a handful of sine waves.
            </li>
          </ul>
        </section>

        <section>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600 }}>
            Design System & Iconography
          </h4>
          <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5 }}>
            Built with design tokens inspired by Mozilla Firefox&apos;s{' '}
            <strong>Acorn Design System</strong>. Iconography is derived from official Mozilla Acorn
            icons licensed under the <strong>Mozilla Public License Version 2.0 (MPL-2.0)</strong>.
          </p>
        </section>

        <section>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600 }}>
            Keyboard Shortcuts
          </h4>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.5 }}>
            <li>
              <kbd>Ctrl+Z</kbd> / <kbd>Cmd+Z</kbd>: Undo manual layer edit
            </li>
            <li>
              <kbd>Ctrl+Y</kbd> / <kbd>Cmd+Shift+Z</kbd>: Redo manual layer edit
            </li>
            <li>
              <kbd>Left</kbd> / <kbd>Right</kbd> arrow keys: Scrub audio cursor when waveform canvas
              is focused
            </li>
            <li>
              <kbd>Escape</kbd>: Close dialogs
            </li>
          </ul>
        </section>

        <section>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600 }}>Local Privacy</h4>
          <p
            style={{ margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--color-success)' }}
          >
            &ldquo;{APP_CONFIG.privacyNotice}&rdquo; All DSP analysis, Web Worker conversion, and
            code exports run 100% locally in your browser with zero external requests.
          </p>
        </section>
      </div>
    </Dialog>
  );
};
