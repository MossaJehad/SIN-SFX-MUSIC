import React from 'react';
import './Badge.css';

export interface BadgeProps {
  variant?: 'default' | 'accent' | 'success' | 'warning' | 'critical' | 'subtle';
  children: React.ReactNode;
  className?: string;
}

export const Badge: React.FC<BadgeProps> = ({ variant = 'default', children, className = '' }) => {
  return <span className={`acorn-badge acorn-badge--${variant} ${className}`}>{children}</span>;
};
