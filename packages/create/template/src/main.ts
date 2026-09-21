import passages from './story/main.inkdown';
import { createApp } from './ui';
import './style.css';

const host = document.querySelector<HTMLElement>('#app');

if (!host) throw new Error('Missing #app host');

const requested = new URLSearchParams(location.search).get('environment');

const environment = ['wiki', 'story-flow', 'visual-novel'].includes(requested ?? '')
  ? (requested as 'wiki' | 'story-flow' | 'visual-novel')
  : undefined;

const app = createApp(host, passages, {
  entry: 'Start',
  state: { visits: 0 },
  environment,
});

(window as Window & { gnehApp?: typeof app }).gnehApp = app;

if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
