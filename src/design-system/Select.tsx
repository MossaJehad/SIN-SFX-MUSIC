import React from 'react';
import './Select.css';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  options: SelectOption[];
}

export const Select: React.FC<SelectProps> = ({ label, options, id, className = '', ...props }) => {
  return (
    <div className={`acorn-select-container ${className}`}>
      {label && (
        <label htmlFor={id} className="acorn-select-label">
          {label}
        </label>
      )}
      <div className="acorn-select-wrapper">
        <select id={id} className="acorn-select" {...props}>
          {options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="acorn-select-arrow" aria-hidden="true">
          ▾
        </span>
      </div>
    </div>
  );
};
