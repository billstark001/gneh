import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { DOMRenderer, type DOMMount } from '@gneh/renderer-dom';
import type { View } from '@gneh/core';
import type { Story } from '@gneh/runtime';

function StoryView({ view }: { view: View[] }) {
  const host = useRef<HTMLElement>(null);
  const renderer = useMemo(() => new DOMRenderer(), []);
  const mount = useRef<DOMMount | undefined>(undefined);
  useEffect(() => {
    if (!host.current) return;
    if (mount.current) renderer.update(mount.current, view);
    else mount.current = renderer.mount(host.current, view);
  }, [renderer, view]);
  useEffect(
    () => () => {
      if (mount.current) renderer.dispose(mount.current);
      mount.current = undefined;
    },
    [renderer],
  );
  return <article ref={host} />;
}

export function App({ story }: { story: Story }) {
  const [view, setView] = useState(story.view);
  const [, redraw] = useState(0);
  useEffect(
    () =>
      story.subscribe((next) => {
        setView(next);
        redraw((value) => value + 1);
      }),
    [story],
  );
  return (
    <div class="gneh-app" data-environment="story-flow">
      <header class="toolbar">
        <strong>
          GNĒH <small>Preact starter</small>
        </strong>
        <button onClick={() => story.undo()} disabled={!story.canUndo}>
          Undo
        </button>
        <button onClick={() => story.redo()} disabled={!story.canRedo}>
          Redo
        </button>
        <button onClick={() => localStorage.setItem('gneh:save', story.save())}>Save</button>
        <button
          onClick={() => {
            const saved = localStorage.getItem('gneh:save');
            if (saved) story.load(saved);
          }}
        >
          Load
        </button>
      </header>
      <div class="layout">
        <aside>
          <p>PASSAGES</p>
          <nav>
            {[...story.passages.values()]
              .filter((fragment) => fragment.metadata.nav !== false)
              .map((fragment) => (
                <button
                  key={fragment.id}
                  aria-current={fragment.id === story.current ? 'page' : undefined}
                  onClick={() => story.navigate(fragment.id)}
                >
                  {String(fragment.metadata.title ?? fragment.id)}
                </button>
              ))}
          </nav>
        </aside>
        <main>
          <div class="route">{story.current}</div>
          <StoryView view={view} />
        </main>
      </div>
    </div>
  );
}
