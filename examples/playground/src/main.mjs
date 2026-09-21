import { mountStory } from '@gneh/renderer-dom';
import { definePassages } from '@gneh/runtime';
import project from '../gneh.config.json';
import main from '../story/main.inkdown';
import reading from '../story/reading.karlowe';
import vault from '../story/vault.sugarcast';
import './style.css';

const host = document.querySelector('#story');

if (!host) throw new Error('Missing #story host');

document.title = project.title;

const app = mountStory(host, definePassages(main, reading, vault), {
  entry: project.entry,
  state: structuredClone(project.state),
});

window.gnehApp = app;

if (import.meta.hot) import.meta.hot.dispose(() => app.dispose());
