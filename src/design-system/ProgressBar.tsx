import React from 'react';
import './ProgressBar.css';

export interface ProgressBarProps {
  progress: number; // 0..1
  label?: string;
  className?: string;
}

export const ProgressBar: React.FC<ProgressBarProps> = ({ progress, label, className = '' }) => {
  const percent = Math.min(100, Math.max(0, Math.round(progress * 100)));

  return (
    <div className={`acorn-progress-container ${className}`}>
      {label && (
        <div className="acorn-progress-label-row">
          <span className="acorn-progress-label">{label}</span>
          <span className="acorn-progress-percentage">{percent}%</span>
        </div>
      )}
      <div
        className="acorn-progress-track"
        role="progressbar"
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label || 'Progress'}
      >
        <div className="acorn-progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
};
