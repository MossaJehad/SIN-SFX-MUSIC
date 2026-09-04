import React, { useId } from 'react';
import { AcornIcon } from './icons/AcornIcon';
import './SliderWithInput.css';

export interface SliderWithInputProps {
  label: string;
  value: number;
  defaultValue?: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  displayMultiplier?: number; // e.g., 1000 to show ms when value is in seconds
  displayDecimals?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
  tooltip?: string;
}

export const SliderWithInput: React.FC<SliderWithInputProps> = ({
  label,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  unit = '',
  displayMultiplier = 1,
  displayDecimals = 0,
  onChange,
  disabled = false,
  tooltip,
}) => {
  const id = useId();
  const sliderId = `${id}-slider`;
  const numberId = `${id}-num`;

  const displayedValue = Number((value * displayMultiplier).toFixed(displayDecimals));
  const minDisplayed = min * displayMultiplier;
  const maxDisplayed = max * displayMultiplier;
  const stepDisplayed = step * displayMultiplier;

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = parseFloat(e.target.value);
    const actualVal = rawVal / displayMultiplier;
    onChange(Math.max(min, Math.min(max, actualVal)));
  };

  const handleNumberChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = parseFloat(e.target.value);
    if (!isNaN(rawVal)) {
      const actualVal = rawVal / displayMultiplier;
      onChange(Math.max(min, Math.min(max, actualVal)));
    }
  };

  const handleReset = () => {
    if (defaultValue !== undefined) {
      onChange(defaultValue);
    }
  };

  const hasChangedFromDefault =
    defaultValue !== undefined && Math.abs(value - defaultValue) > 0.0001;

  return (
    <div className={`acorn-control-field ${disabled ? 'acorn-control-field--disabled' : ''}`}>
      <div className="acorn-control-field__header">
        <label htmlFor={sliderId} className="acorn-control-field__label" title={tooltip}>
          {label}
        </label>
        <div className="acorn-control-field__right">
          <div className="acorn-control-field__input-wrapper">
            <input
              id={numberId}
              type="number"
              aria-label={`${label} exact value in ${unit || 'units'}`}
              value={displayedValue}
              min={minDisplayed}
              max={maxDisplayed}
              step={stepDisplayed}
              onChange={handleNumberChange}
              disabled={disabled}
              className="acorn-control-field__number-input"
            />
            {unit && <span className="acorn-control-field__unit">{unit}</span>}
          </div>
          {defaultValue !== undefined && (
            <button
              type="button"
              onClick={handleReset}
              disabled={disabled || !hasChangedFromDefault}
              title={`Reset to default (${defaultValue * displayMultiplier}${unit})`}
              className="acorn-control-field__reset-btn"
              aria-label={`Reset ${label} to default`}
            >
              <AcornIcon name="reset" size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="acorn-control-field__slider-wrapper">
        <input
          id={sliderId}
          type="range"
          aria-label={label}
          min={minDisplayed}
          max={maxDisplayed}
          step={stepDisplayed}
          value={displayedValue}
          onChange={handleSliderChange}
          disabled={disabled}
          className="acorn-control-field__range-slider"
        />
      </div>
    </div>
  );
};
