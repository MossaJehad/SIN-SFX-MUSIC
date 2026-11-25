import React, { useRef } from 'react';
import { useAudioStore } from '@/features/editor/useAudioStore';
import { APP_CONFIG, PresetKey } from '@/config/appConfig';
import { Button } from '@/design-system/Button';
import { Select } from '@/design-system/Select';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import './Header.css';

export const Header: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    theme,
    setTheme,
    preset,
    setPreset,
    loadAudioFromFile,
    loadExampleRecipe,
    clearOriginalAudio,
    setIsAboutModalOpen,
  } = useAudioStore();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await loadAudioFromFile(file);
      e.target.value = '';
    }
  };

  const handleExampleSelect = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val) {
      await loadExampleRecipe(val);
      e.target.value = '';
    }
  };

  const toggleTheme = () => {
    setTheme(theme === 'light' ? 'dark' : 'light');
  };

  return (
    <header className="acorn-app-header">
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/wav,audio/mpeg,audio/ogg,audio/webm,audio/flac,audio/*,.wav,.mp3,.ogg,.webm,.flac,.m4a"
        className="visually-hidden"
        onChange={handleFileChange}
        aria-label="Upload Audio File"
      />

      <div className="acorn-app-header__left">
        <div className="acorn-app-header__brand">
          <AcornIcon name="wave" size={20} className="acorn-app-header__logo-icon" />
          <div>
            <h1 className="acorn-app-header__title">{APP_CONFIG.name}</h1>
            <span className="acorn-app-header__version">v{APP_CONFIG.version} DSP</span>
          </div>
        </div>

        <div className="acorn-app-header__actions">
          <Button
            variant="secondary"
            size="sm"
            onClick={clearOriginalAudio}
            title="Clear uploaded audio and reset workspace"
          >
            New Project
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            title="Upload WAV, MP3, OGG, WebM, or FLAC audio file (up to 15s, 25 MB)"
          >
            <AcornIcon name="upload" size={14} />
            Upload Audio
          </Button>

          <div className="acorn-app-header__example-wrapper">
            <Select
              id="example-selector"
              aria-label="Load built-in procedural sound effect example"
              options={[
                { value: '', label: 'Load Example...' },
                { value: 'ui-click', label: 'UI Click (Interface)' },
                { value: 'coin-pickup', label: 'Coin Pickup (Item)' },
                { value: 'laser', label: 'Laser (Combat)' },
                { value: 'jump', label: 'Jump (Movement)' },
                { value: 'hit', label: 'Hit (Combat)' },
                { value: 'small-explosion', label: 'Small Explosion' },
              ]}
              onChange={handleExampleSelect}
            />
          </div>
        </div>
      </div>

      <div className="acorn-app-header__right">
        <div className="acorn-app-header__preset-group">
          <span className="acorn-app-header__label">Preset:</span>
          <Select
            id="global-preset-selector"
            aria-label="Quality preset"
            value={preset}
            options={[
              { value: 'tiny', label: 'Tiny (Procedural)' },
              { value: 'balanced', label: 'Balanced (Optimized)' },
              { value: 'accurate', label: 'Accurate (High-Res)' },
              { value: 'exact', label: 'Exact (Fourier Baseline)' },
            ]}
            onChange={(e) => setPreset(e.target.value as PresetKey)}
          />
        </div>

        <Button
          variant="ghost"
          size="icon"
          onClick={toggleTheme}
          title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
        >
          <AcornIcon name={theme === 'light' ? 'moon' : 'sun'} size={16} />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={() => setIsAboutModalOpen(true)}
          title="About & Privacy Info"
          aria-label="About and privacy information"
        >
          <AcornIcon name="info" size={16} />
        </Button>
      </div>
    </header>
  );
};
