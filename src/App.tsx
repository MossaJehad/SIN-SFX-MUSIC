import React, { useEffect } from 'react';
import { Header } from '@/components/Header';
import { PrivacyBanner } from '@/components/PrivacyBanner';
import { OriginalAudioPanel } from '@/features/editor/OriginalAudioPanel';
import { ProceduralEditorPanel } from '@/features/editor/ProceduralEditorPanel';
import { WaveformComparisonPanel } from '@/features/editor/WaveformComparisonPanel';
import { QualityAndExportPanel } from '@/features/editor/QualityAndExportPanel';
import { AboutModal } from '@/components/AboutModal';
import { Tabs, TabItem } from '@/design-system/Tabs';
import { useAudioStore } from '@/features/editor/useAudioStore';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import './App.css';

export const App: React.FC = () => {
  const { activeMainTab, setActiveMainTab, originalBuffer, loadExampleRecipe } = useAudioStore();

  // Load default initial sound on mount
  useEffect(() => {
    loadExampleRecipe('ui-click');
  }, [loadExampleRecipe]);

  const tabs: TabItem[] = [
    {
      id: 'editor',
      label: 'Editor & Synthesis',
      icon: <AcornIcon name="sliders" size={14} />,
    },
    {
      id: 'comparison',
      label: 'Waveforms & Approximation',
      icon: <AcornIcon name="wave" size={14} />,
      badge: originalBuffer ? 'Aligned' : undefined,
    },
    {
      id: 'export',
      label: 'Quality, Size & Export',
      icon: <AcornIcon name="download" size={14} />,
    },
  ];

  return (
    <div className="acorn-app-root">
      {/* Top Toolbar */}
      <Header />

      {/* Privacy Notice Banner */}
      <PrivacyBanner />

      {/* Responsive Navigation Tabs (Visible on Tablet / Mobile) */}
      <div className="acorn-app-mobile-nav">
        <Tabs
          tabs={tabs}
          activeTab={activeMainTab}
          onChange={(id) => setActiveMainTab(id as 'editor' | 'comparison' | 'export')}
        />
      </div>

      {/* Main Workspace */}
      <main className="acorn-app-workspace" id="main-content">
        {/* Desktop 3-Column Layout / Tablet Tabbed Display */}
        <section
          className={`workspace-column column--original ${
            activeMainTab === 'editor' ? 'workspace-column--visible' : ''
          }`}
          aria-label="Original Audio Section"
        >
          <OriginalAudioPanel />
        </section>

        <section
          className={`workspace-column column--editor ${
            activeMainTab === 'editor' ? 'workspace-column--visible' : ''
          }`}
          aria-label="Procedural Synthesis Section"
        >
          <ProceduralEditorPanel />
        </section>

        <section
          className={`workspace-column column--output ${
            activeMainTab === 'comparison' || activeMainTab === 'export'
              ? 'workspace-column--visible'
              : ''
          }`}
          aria-label="Comparison and Export Section"
        >
          <div className="output-column-stack">
            <WaveformComparisonPanel />
            <QualityAndExportPanel />
          </div>
        </section>
      </main>

      {/* About & Privacy Modal */}
      <AboutModal />
    </div>
  );
};

export default App;
