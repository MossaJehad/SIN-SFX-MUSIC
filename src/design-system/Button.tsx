import React, { forwardRef } from 'react';
import './Button.css';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive' | 'active';
  size?: 'xs' | 'sm' | 'md' | 'icon';
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { variant = 'secondary', size = 'sm', iconOnly = false, className = '', children, ...props },
    ref
  ) => {
    const classNames = [
      'acorn-button',
      `acorn-button--${variant}`,
      `acorn-button--${size}`,
      iconOnly ? 'acorn-button--icon-only' : '',
      className,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <button ref={ref} className={classNames} {...props}>
        {children}
      </button>
    );
  }
);

Button.displayName = 'Button';
