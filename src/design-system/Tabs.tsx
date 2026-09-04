import React, { useRef } from 'react';
import './Tabs.css';

export interface TabItem {
  id: string;
  label: React.ReactNode;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  tabs: TabItem[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
}

export const Tabs: React.FC<TabsProps> = ({ tabs, activeTab, onChange, className = '' }) => {
  const tabListRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let targetIndex = -1;
    if (e.key === 'ArrowRight') {
      targetIndex = (index + 1) % tabs.length;
    } else if (e.key === 'ArrowLeft') {
      targetIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (e.key === 'Home') {
      targetIndex = 0;
    } else if (e.key === 'End') {
      targetIndex = tabs.length - 1;
    }

    if (targetIndex !== -1) {
      e.preventDefault();
      const targetTab = tabs[targetIndex];
      if (targetTab && !targetTab.disabled) {
        onChange(targetTab.id);
        const buttons = tabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]');
        buttons?.[targetIndex]?.focus();
      }
    }
  };

  return (
    <div
      ref={tabListRef}
      role="tablist"
      aria-label="Section Tabs"
      className={`acorn-tabs ${className}`}
    >
      {tabs.map((tab, idx) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            id={`tab-${tab.id}`}
            aria-controls={`tabpanel-${tab.id}`}
            aria-selected={isActive}
            tabIndex={isActive ? 0 : -1}
            disabled={tab.disabled}
            className={`acorn-tab ${isActive ? 'acorn-tab--active' : ''}`}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => handleKeyDown(e, idx)}
          >
            {tab.icon && <span className="acorn-tab__icon">{tab.icon}</span>}
            <span className="acorn-tab__label">{tab.label}</span>
            {tab.badge && <span className="acorn-tab__badge">{tab.badge}</span>}
          </button>
        );
      })}
    </div>
  );
};
