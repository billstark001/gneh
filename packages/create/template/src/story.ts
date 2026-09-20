import type { AnyFragment, State } from '@gneh/core';
import { Story, type StoryOptions } from '@gneh/runtime';

export interface StoryAppOptions {
  entry: string;
  state?: State;
  host?: StoryOptions['host'];
  runtimeExtensions?: StoryOptions['runtimeExtensions'];
}

function browserHost(operation: string, args: readonly unknown[], story: Story): unknown {
  const slot = String(args[0] ?? 'default');
  switch (operation) {
    case 'prompt':
      return window.prompt(String(args[0] ?? ''), String(args[1] ?? '')) ?? String(args[1] ?? '');
    case 'open-external':
      return window.open(String(args[0] ?? ''), '_blank', 'noopener,noreferrer');
    case 'restart':
      window.location.reload();
      return;
    case 'save':
      localStorage.setItem(`gneh:slot:${slot}`, story.save());
      return true;
    case 'load': {
      const saved = localStorage.getItem(`gneh:slot:${slot}`);
      if (saved) story.load(saved);
      return Boolean(saved);
    }
    case 'saved-games':
      return Object.keys(localStorage)
        .filter((key) => key.startsWith('gneh:slot:'))
        .map((key) => key.slice('gneh:slot:'.length));
    case 'undo':
      return story.undo();
    default:
      throw new Error(`Host operation is unavailable: ${operation}`);
  }
}

export function createStory(fragments: readonly AnyFragment[], options: StoryAppOptions): Story {
  return new Story([...fragments], { ...options, host: options.host ?? browserHost });
}
