import React, { useEffect } from 'react';
import { useAudioStore } from './useAudioStore';
import { Button } from '@/design-system/Button';
import { Badge } from '@/design-system/Badge';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import './LayerList.css';

export const LayerList: React.FC = () => {
  const {
    recipe,
    selectedLayerId,
    setSelectedLayerId,
    addLayer,
    duplicateLayer,
    deleteLayer,
    toggleLayerEnabled,
    toggleLayerSolo,
    reorderLayers,
    undo,
    redo,
    history,
    historyIndex,
  } = useAudioStore();

  const canUndo = historyIndex > 0;
  const canRedo = historyIndex < history.length - 1;

  // Keyboard shortcut for Undo / Redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          redo();
        } else {
          e.preventDefault();
          undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [undo, redo]);

  return (
    <div className="acorn-layer-list">
      {/* Header with Add & Undo/Redo */}
      <div className="acorn-layer-list__toolbar">
        <div className="toolbar-left">
          <Button
            variant="primary"
            size="xs"
            onClick={addLayer}
            title="Add a new synthesis oscillator/noise layer"
          >
            <AcornIcon name="plus" size={12} />
            Add Layer
          </Button>
        </div>

        <div className="toolbar-right">
          <Button
            variant="ghost"
            size="icon"
            onClick={undo}
            disabled={!canUndo}
            title="Undo parameter change (Ctrl+Z)"
            aria-label="Undo"
          >
            <AcornIcon name="undo" size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={redo}
            disabled={!canRedo}
            title="Redo parameter change (Ctrl+Y)"
            aria-label="Redo"
          >
            <AcornIcon name="redo" size={14} />
          </Button>
        </div>
      </div>

      {/* Layer Items */}
      <div className="acorn-layer-list__items" role="listbox" aria-label="Synthesis Layers">
        {recipe.layers.map((layer, index) => {
          const isSelected = layer.id === selectedLayerId;

          return (
            <div
              key={layer.id}
              role="option"
              aria-selected={isSelected}
              className={`acorn-layer-item ${isSelected ? 'acorn-layer-item--selected' : ''} ${
                !layer.enabled ? 'acorn-layer-item--muted' : ''
              }`}
              onClick={() => setSelectedLayerId(layer.id)}
            >
              <div className="acorn-layer-item__left">
                {/* Mute/Enable toggle */}
                <button
                  type="button"
                  className={`layer-btn ${layer.enabled ? 'layer-btn--active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerEnabled(layer.id);
                  }}
                  title={layer.enabled ? 'Mute layer' : 'Unmute layer'}
                  aria-label={layer.enabled ? `Mute ${layer.name}` : `Unmute ${layer.name}`}
                >
                  <AcornIcon name={layer.enabled ? 'volume' : 'mute'} size={12} />
                </button>

                {/* Solo toggle */}
                <button
                  type="button"
                  className={`layer-btn layer-btn--solo ${layer.solo ? 'layer-btn--solo-active' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLayerSolo(layer.id);
                  }}
                  title={layer.solo ? 'Unsolo layer' : 'Solo layer'}
                  aria-label={layer.solo ? `Unsolo ${layer.name}` : `Solo ${layer.name}`}
                >
                  S
                </button>

                {/* Layer Name & Type Badge */}
                <span className="layer-name">{layer.name}</span>
                <Badge variant={layer.oscillatorType === 'noise' ? 'default' : 'accent'}>
                  {layer.oscillatorType}
                </Badge>
              </div>

              {/* Action Buttons */}
              <div className="acorn-layer-item__actions">
                {/* Reorder Up */}
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={(e) => {
                    e.stopPropagation();
                    reorderLayers(index, index - 1);
                  }}
                  className="layer-action-btn"
                  title="Move layer up"
                  aria-label="Move layer up"
                >
                  <AcornIcon name="chevron-up" size={12} />
                </button>

                {/* Reorder Down */}
                <button
                  type="button"
                  disabled={index === recipe.layers.length - 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    reorderLayers(index, index + 1);
                  }}
                  className="layer-action-btn"
                  title="Move layer down"
                  aria-label="Move layer down"
                >
                  <AcornIcon name="chevron-down" size={12} />
                </button>

                {/* Duplicate */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    duplicateLayer(layer.id);
                  }}
                  className="layer-action-btn"
                  title="Duplicate layer"
                  aria-label={`Duplicate ${layer.name}`}
                >
                  <AcornIcon name="copy" size={12} />
                </button>

                {/* Delete */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteLayer(layer.id);
                  }}
                  className="layer-action-btn layer-action-btn--delete"
                  title="Delete layer"
                  aria-label={`Delete ${layer.name}`}
                  disabled={recipe.layers.length <= 1}
                >
                  <AcornIcon name="trash" size={12} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
