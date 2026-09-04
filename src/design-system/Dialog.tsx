import React, { useEffect, useRef } from 'react';
import { AcornIcon } from './icons/AcornIcon';
import './Dialog.css';

export interface DialogProps {
  isOpen: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export const Dialog: React.FC<DialogProps> = ({
  isOpen,
  title,
  onClose,
  children,
  footer,
  maxWidth = '520px',
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    // Focus dialog container
    dialogRef.current?.focus();

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="acorn-dialog-overlay" onClick={onClose} role="presentation">
      <div
        ref={dialogRef}
        className="acorn-dialog"
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="acorn-dialog__header">
          <h2 id="dialog-title" className="acorn-dialog__title">
            {title}
          </h2>
          <button
            type="button"
            className="acorn-dialog__close-btn"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <AcornIcon name="close" size={14} />
          </button>
        </div>

        <div className="acorn-dialog__body">{children}</div>

        {footer && <div className="acorn-dialog__footer">{footer}</div>}
      </div>
    </div>
  );
};
