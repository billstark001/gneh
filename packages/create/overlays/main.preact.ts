import { h, render } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import primary, { fragments } from './story/main.inkdown';
import { createApp as createStoryApp } from './ui';
import './style.css';

const requested = new URLSearchParams(location.search).get('environment');

const environment = ['wiki', 'story-flow', 'visual-novel'].includes(requested ?? '')
  ? (requested as 'wiki' | 'story-flow' | 'visual-novel')
  : undefined;

function StoryApplication() {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const app = createStoryApp(host.current, Object.values(fragments), {
      entry: primary.id,
      state: { visits: 0 },
      environment,
    });
    (window as Window & { gnehApp?: typeof app }).gnehApp = app;
    return () => app.dispose();
  }, []);
  return h('div', { ref: host });
}

const root = document.querySelector<HTMLElement>('#app');

if (!root) throw new Error('Missing #app host');

render(h(StoryApplication, {}), root);
