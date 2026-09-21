import { mountStory } from '@gneh/renderer-dom';
import project from '../gneh.config.json';
import passages from '../story.inkdown';
import './style.css';

const host = document.querySelector('#story');

if (!host) throw new Error('Missing #story host');

document.title = project.title;

const app = mountStory(host, passages, {
  entry: project.entry,
  state: structuredClone(project.state),
});

window.gnehApp = app;

if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
