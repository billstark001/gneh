import { mountStory } from '@gneh/renderer-dom';
import { definePassages } from '@gneh/runtime';
import 'katex/dist/katex.min.css';
import ModelLab from './ModelLab.mjs';
import { latexDOM } from './latex-plugin.mjs';
import notes from './notes.md?raw';
import wikiPassages from './story.inkdown';
import './style.css';

const host = document.querySelector('#story');
const navigation = document.querySelector('#wiki-navigation');
const search = document.querySelector('#wiki-search');
const context = document.querySelector('#app-context');
const route = document.querySelector('#current-route');
const completed = document.querySelector('#completed-count');
const progress = document.querySelector('#reading-progress');
const status = document.querySelector('#app-status');

if (!host || !navigation || !search || !context || !route || !completed || !progress || !status) {
  throw new Error('The opinion Wiki application shell is incomplete.');
}

context.textContent = notes;

const passages = definePassages(wikiPassages, ModelLab);
const app = mountStory(host, passages, {
  entry: 'Primer',
  state: { completed: [], confidence: 0.25 },
  // Wiki projection evaluates and displays every declarative step at once.
  flow: { projection: 'all' },
  renderer: { plugins: [latexDOM()] },
});

const entries = Object.values(passages)
  .filter((passage) => passage.metadata.nav !== false)
  .sort((left, right) => Number(left.metadata.order ?? 0) - Number(right.metadata.order ?? 0));
const navButtons = new Map();

for (const passage of entries) {
  const group = String(passage.metadata.group ?? 'Explore');
  let section = [...navigation.querySelectorAll('section')].find((item) => item.dataset.group === group);
  if (!section) {
    section = document.createElement('section');
    section.dataset.group = group;
    const heading = document.createElement('h2');
    heading.textContent = group;
    const list = document.createElement('div');
    list.className = 'nav-list';
    section.append(heading, list);
    navigation.append(section);
  }

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = String(passage.metadata.title ?? passage.id);
  button.dataset.passage = passage.id;
  button.addEventListener('click', () => app.story.navigate(passage.id));
  section.querySelector('.nav-list').append(button);
  navButtons.set(passage.id, button);
}

search.addEventListener('input', () => {
  const query = search.value.trim().toLocaleLowerCase();
  for (const [id, button] of navButtons) {
    const passage = passages[id];
    const haystack = [id, passage.metadata.title, passage.metadata.group, ...(passage.metadata.tags ?? [])]
      .join(' ')
      .toLocaleLowerCase();
    button.hidden = Boolean(query) && !haystack.includes(query);
  }
  for (const section of navigation.querySelectorAll('section')) {
    section.hidden = ![...section.querySelectorAll('button')].some((button) => !button.hidden);
  }
});

const undo = document.querySelector('[data-command="undo"]');
const redo = document.querySelector('[data-command="redo"]');
undo.addEventListener('click', () => app.story.undo());
redo.addEventListener('click', () => app.story.redo());
document.querySelector('[data-command="save"]').addEventListener('click', () => {
  localStorage.setItem('gneh:opinion-wiki', app.story.save());
  status.textContent = 'Reading state saved locally.';
});
document.querySelector('[data-command="load"]').addEventListener('click', () => {
  const saved = localStorage.getItem('gneh:opinion-wiki');
  if (!saved) {
    status.textContent = 'No local reading state found.';
    return;
  }
  app.story.load(saved);
  status.textContent = 'Reading state restored.';
});

const unsubscribe = app.story.subscribe(() => {
  const current = passages[app.story.current];
  const count = Array.isArray(app.story.state.completed) ? app.story.state.completed.length : 0;
  route.textContent = `Primer / ${String(current?.metadata.title ?? app.story.current)}`;
  completed.textContent = `${count} / 5 topics`;
  progress.value = count;
  undo.disabled = !app.story.canUndo;
  redo.disabled = !app.story.canRedo;
  for (const [id, button] of navButtons) {
    button.setAttribute('aria-current', id === app.story.current ? 'page' : 'false');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

window.gnehApp = app;
window.gnehTest = { passages };

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unsubscribe();
    app.dispose();
  });
}
