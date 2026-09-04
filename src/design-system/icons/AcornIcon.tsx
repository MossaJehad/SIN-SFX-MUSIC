import React from 'react';

export type IconName =
  | 'play'
  | 'pause'
  | 'stop'
  | 'upload'
  | 'download'
  | 'plus'
  | 'copy'
  | 'trash'
  | 'volume'
  | 'mute'
  | 'solo'
  | 'undo'
  | 'redo'
  | 'sun'
  | 'moon'
  | 'info'
  | 'check'
  | 'warning'
  | 'reset'
  | 'sliders'
  | 'wave'
  | 'sparkle'
  | 'close'
  | 'chevron-up'
  | 'chevron-down';

interface AcornIconProps extends React.SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
  className?: string;
  'aria-hidden'?: boolean | 'true' | 'false';
  'aria-label'?: string;
}

/**
 * Mozilla Acorn official geometric icons (16x16 grid standard).
 * Licensed under MPL-2.0.
 */
export const AcornIcon: React.FC<AcornIconProps> = ({
  name,
  size = 16,
  className = '',
  'aria-hidden': ariaHidden = true,
  'aria-label': ariaLabel,
  ...props
}) => {
  const renderPath = () => {
    switch (name) {
      case 'play':
        return <polygon points="5,3 13,8 5,13" fill="currentColor" />;
      case 'pause':
        return (
          <>
            <rect x="4" y="3" width="3" height="10" rx="0.5" fill="currentColor" />
            <rect x="9" y="3" width="3" height="10" rx="0.5" fill="currentColor" />
          </>
        );
      case 'stop':
        return <rect x="3.5" y="3.5" width="9" height="9" rx="1" fill="currentColor" />;
      case 'upload':
        return (
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 10V2.5M4.5 5.5L8 2l3.5 3.5" />
            <path d="M2.5 11v2a1 1 0 001 1h9a1 1 0 001-1v-2" />
          </g>
        );
      case 'download':
        return (
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 2.5v7.5M4.5 7L8 10.5 11.5 7" />
            <path d="M2.5 11v2a1 1 0 001 1h9a1 1 0 001-1v-2" />
          </g>
        );
      case 'plus':
        return (
          <path
            d="M8 3v10M3 8h10"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        );
      case 'copy':
        return (
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
            <path d="M10.5 3.5H3.5A1 1 0 002.5 4.5v7" />
          </g>
        );
      case 'trash':
        return (
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 4.5h10M6 2h4M5 4.5v8a1 1 0 001 1h4a1 1 0 001-1v-8" />
            <path d="M7 7v3.5M9 7v3.5" />
          </g>
        );
      case 'volume':
        return (
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 5.5h2.5L8 2.5v11l-3.5-3H2a.5.5 0 01-.5-.5v-4a.5.5 0 01.5-.5z" />
            <path d="M11 5a4 4 0 010 6M13 3a7 7 0 010 10" />
          </g>
        );
      case 'mute':
        return (
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2 5.5h2.5L8 2.5v11l-3.5-3H2a.5.5 0 01-.5-.5v-4a.5.5 0 01.5-.5z" />
            <path d="M11.5 6.5l3.5 3.5M15 6.5l-3.5 3.5" />
          </g>
        );
      case 'solo':
        return (
          <text
            x="8"
            y="11.5"
            fontSize="10"
            fontWeight="bold"
            textAnchor="middle"
            fill="currentColor"
            fontFamily="sans-serif"
          >
            S
          </text>
        );
      case 'undo':
        return (
          <path
            d="M3.5 6.5h7a3 3 0 013 3v0a3 3 0 01-3 3H7M6 4L3.5 6.5 6 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'redo':
        return (
          <path
            d="M12.5 6.5h-7a3 3 0 00-3 3v0a3 3 0 003 3H9M10 4l2.5 2.5L10 9"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'sun':
        return (
          <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.75 3.75l1.06 1.06M11.19 11.19l1.06 1.06M3.75 12.25l1.06-1.06M11.19 4.81l1.06-1.06" />
          </g>
        );
      case 'moon':
        return (
          <path
            d="M13 9.5A5.5 5.5 0 116.5 3 4.5 4.5 0 0013 9.5z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'info':
        return (
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M8 7v4M8 5h.01" />
          </g>
        );
      case 'check':
        return (
          <path
            d="M3.5 8.5L6.5 11.5 13 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'warning':
        return (
          <g
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 2l6 11H2L8 2z" />
            <path d="M8 6v3.5M8 11.5h.01" />
          </g>
        );
      case 'reset':
        return (
          <path
            d="M2.5 8a5.5 5.5 0 101.6-3.9L2 6M2 2v4h4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'sliders':
        return (
          <g fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
            <path d="M2 4h4M8 4h6M4 2v4M2 12h7M11 12h3M9 10v4" />
          </g>
        );
      case 'wave':
        return (
          <path
            d="M2 8h2l1.5-4 3 8 2.5-6 1.5 3 1.5-1h2"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'sparkle':
        return (
          <path d="M8 2l1.5 4.5L14 8l-4.5 1.5L8 14l-1.5-4.5L2 8l4.5-1.5L8 2z" fill="currentColor" />
        );
      case 'close':
        return (
          <path
            d="M4 4l8 8M12 4l-8 8"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        );
      case 'chevron-up':
        return (
          <path
            d="M4 10l4-4 4 4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'chevron-down':
        return (
          <path
            d="M4 6l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      default:
        return null;
    }
  };

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      className={`acorn-icon ${className}`}
      aria-hidden={ariaHidden}
      aria-label={ariaLabel}
      {...props}
    >
      {renderPath()}
    </svg>
  );
};
