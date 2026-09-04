import React from 'react';
import './Card.css';

export interface CardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  compact?: boolean;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  actions,
  compact = false,
  className = '',
  children,
  ...props
}) => {
  return (
    <div className={`acorn-card ${compact ? 'acorn-card--compact' : ''} ${className}`} {...props}>
      {(title || actions) && (
        <div className="acorn-card__header">
          <div className="acorn-card__header-text">
            {title && <h3 className="acorn-card__title">{title}</h3>}
            {subtitle && <p className="acorn-card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="acorn-card__actions">{actions}</div>}
        </div>
      )}
      <div className="acorn-card__body">{children}</div>
    </div>
  );
};
