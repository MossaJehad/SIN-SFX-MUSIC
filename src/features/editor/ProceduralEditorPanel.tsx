import React from 'react';
import { useAudioStore } from './useAudioStore';
import { Card } from '@/design-system/Card';
import { Button } from '@/design-system/Button';
import { Badge } from '@/design-system/Badge';
import { AcornIcon } from '@/design-system/icons/AcornIcon';
import { LayerList } from './LayerList';
import { LayerEditor } from './LayerEditor';
import './ProceduralEditorPanel.css';

export const ProceduralEditorPanel: React.FC = () => {
  const { recipe, isPlaying, activePlaybackSource, playProcedural, stopPlayback, currentTime } =
    useAudioStore();

  const isPlayingThis = isPlaying && activePlaybackSource === 'procedural';

  return (
    <Card
      title="2. Procedural Editor"
      subtitle={`${recipe.layers.length} layers · ${recipe.duration.toFixed(2)}s master`}
      actions={
        <div className="procedural-editor-panel__header-actions">
          <Badge variant="accent">{recipe.category || 'Custom SFX'}</Badge>
          <Button
            variant={isPlayingThis ? 'active' : 'primary'}
            size="xs"
            onClick={isPlayingThis ? stopPlayback : playProcedural}
            title="Preview entire procedural sound (Spacebar)"
            aria-label={isPlayingThis ? 'Stop procedural sound' : 'Play procedural sound'}
          >
            <AcornIcon name={isPlayingThis ? 'stop' : 'play'} size={12} />
            {isPlayingThis ? `Stop (${currentTime.toFixed(2)}s)` : 'Play Sound'}
          </Button>
        </div>
      }
      className="procedural-editor-panel"
    >
      <div className="procedural-editor-panel__inner">
        <div className="procedural-editor-panel__layers-sidebar">
          <LayerList />
        </div>
        <div className="procedural-editor-panel__layer-params">
          <LayerEditor />
        </div>
      </div>
    </Card>
  );
};
