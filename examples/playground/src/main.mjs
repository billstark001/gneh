import { mountStory } from '@gneh/renderer-dom';
import { definePassages } from '@gneh/runtime';
import project from '../gneh.config.json';
import main from '../story/main.inkdown';
import reading from '../story/reading.karlowe';
import vault from '../story/vault.sugarcast';
import './style.css';

const host = document.querySelector('#story');
const route = document.querySelector('#route');
const status = document.querySelector('#app-status');
const undo = document.querySelector('#undo');
const redo = document.querySelector('#redo');
const save = document.querySelector('#save');
const load = document.querySelector('#load');
const reset = document.querySelector('#reset');
const saveKey = 'gneh:nocturne-house';

if (!host || !route || !status || !undo || !redo || !save || !load || !reset) {
  throw new Error('Missing playground application shell');
}

document.title = project.title;

const app = mountStory(host, definePassages(main, reading, vault), {
  entry: project.entry,
  state: structuredClone(project.state),
});

function announce(message) {
  status.textContent = message;
}

function updateChrome() {
  route.textContent = app.story.current;
  undo.disabled = !app.story.canUndo;
  redo.disabled = !app.story.canRedo;
  load.disabled = localStorage.getItem(saveKey) === null;
}

undo.addEventListener('click', () => {
  if (app.story.undo()) announce('The last moment folds quietly backward.');
});

redo.addEventListener('click', () => {
  if (app.story.redo()) announce('The moment returns, warm and intact.');
});

save.addEventListener('click', () => {
  localStorage.setItem(saveKey, app.story.save());
  announce('This night has been pressed between the pages.');
  updateChrome();
});

load.addEventListener('click', () => {
  const snapshot = localStorage.getItem(saveKey);
  if (!snapshot) return;
  app.story.load(snapshot);
  announce('The house remembers where you left off.');
});

reset.addEventListener('click', () => {
  app.story.reset();
  announce('The kettle begins its song again.');
});

const unsubscribeChrome = app.story.subscribe(updateChrome);
updateChrome();

window.gnehApp = app;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribeChrome();
    app.dispose();
  });
}
