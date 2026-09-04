import React, { useState } from 'react';
import { APP_CONFIG } from '@/config/appConfig';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import './PrivacyBanner.css';

export const PrivacyBanner: React.FC = () => {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="acorn-privacy-banner" role="region" aria-label="Privacy guarantee">
      <div className="acorn-privacy-banner__content">
        <AcornIcon name="check" size={14} className="acorn-privacy-banner__icon" />
        <span className="acorn-privacy-banner__text">
          <strong>Local-First Guarantee:</strong> {APP_CONFIG.privacyNotice} No cloud servers,
          telemetry, or external APIs are contacted.
        </span>
      </div>
      <button
        type="button"
        className="acorn-privacy-banner__dismiss"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss privacy notice"
      >
        <AcornIcon name="close" size={12} />
      </button>
    </div>
  );
};
