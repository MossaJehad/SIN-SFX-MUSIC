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
      maxWidth="620px"
    >
      <div
        className="about-modal-content"
        style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}
      >
        <section>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600 }}>
            What this MVP does
          </h4>
          <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5 }}>
            {APP_CONFIG.name} is a local-first web application that analyzes short game sound
            effects (under 3.0s, under 10MB) such as UI clicks, coin pickups, lasers, jumps, hits,
            and explosions, and converts them into small, editable procedural Web Audio recipes.
          </p>
        </section>

        <section>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600 }}>
            What this MVP does NOT do
          </h4>
          <ul style={{ margin: 0, paddingLeft: '20px', fontSize: '13px', lineHeight: 1.5 }}>
            <li>
              It is <strong>not</strong> lossless audio compression. The procedural result is an
              approximation.
            </li>
            <li>
              It does not convert music, vocals, speech, or complex polyphonic orchestrations.
            </li>
            <li>
              No cloud AI, server processing, accounts, or telemetry. Everything runs locally in
              this browser tab.
            </li>
          </ul>
        </section>

        <section>
          <h4 style={{ margin: '0 0 6px 0', fontSize: '14px', fontWeight: 600 }}>
            Design System & Iconography
          </h4>
          <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.5 }}>
            Built using design tokens and visual guidelines inspired by Mozilla Firefox's{' '}
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
              <kbd>Ctrl+Z</kbd> / <kbd>Cmd+Z</kbd>: Undo recipe parameter edit
            </li>
            <li>
              <kbd>Ctrl+Y</kbd> / <kbd>Cmd+Shift+Z</kbd>: Redo recipe parameter edit
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
            "{APP_CONFIG.privacyNotice}" The application makes zero outbound network requests
            containing your audio.
          </p>
        </section>
      </div>
    </Dialog>
  );
};
