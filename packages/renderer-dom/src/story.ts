import type { AnyFragment, StoryIR } from '@gneh/core';
import { Story, type StoryOptions } from '@gneh/runtime';
import { DOMRenderer, type DOMMount, type DOMOptions } from './renderer.js';

export interface DOMStoryOptions extends StoryOptions {
  renderer?: DOMOptions;
}

export interface DOMStoryMount {
  story: Story;
  renderer: DOMRenderer;
  mount: DOMMount;
  dispose(): void;
}

/**
 * Connect a Story to one DOM host without installing styles, global listeners or routing.
 *
 * This deliberately small adapter is useful for plain DOM applications. React, Vue and
 * other renderers can subscribe to Story directly instead of using it.
 */
export function mountStory(
  host: HTMLElement,
  input: Story | StoryIR | AnyFragment[],
  options: DOMStoryOptions = {},
): DOMStoryMount {
  const owned = !(input instanceof Story);
  const story = input instanceof Story ? input : new Story(input, options);
  const renderer = new DOMRenderer(options.renderer);
  const mount = renderer.mount(host, story.view);
  const unsubscribe = story.subscribe((view) => renderer.update(mount, view));
  let disposed = false;

  return {
    story,
    renderer,
    mount,
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      renderer.dispose(mount);
      if (owned) story.dispose();
    },
  };
}
