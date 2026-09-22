import { DOMRenderer } from '@gneh/renderer-dom';
import { definePassages, Story } from '@gneh/runtime';
import project from '../gneh.config.json';
import definitions from '../story/00-definitions.inkdown';
import arrival from '../story/01-arrival.inkdown';
import theCircle from '../story/02-the-circle.inkdown';
import sisterShift from '../story/03-sister-shift.inkdown';
import offer from '../story/04-the-offer.inkdown';
import theCall from '../story/05-the-call.inkdown';
import endings from '../story/06-endings.inkdown';
import caseNotes from '../story/07-case-notes.inkdown';
import './style.css';

const passages = definePassages(definitions, arrival, theCircle, sisterShift, offer, theCall, endings, caseNotes);
const story = new Story(passages, {
  entry: project.entry,
  state: structuredClone(project.state),
});
const renderer = new DOMRenderer({
  onError(error) {
    announce(error instanceof Error ? error.message : String(error), true);
  },
});

const root = document.querySelector('#app');
const content = document.querySelector('#story');
const choices = document.querySelector('#choices');
const route = document.querySelector('#route');
const routeTitle = document.querySelector('#route-title');
const beatCounter = document.querySelector('#beat-counter');
const status = document.querySelector('#app-status');
const dialogue = document.querySelector('#dialogue-window');
const next = document.querySelector('#next');
const undo = document.querySelector('#undo');
const redo = document.querySelector('#redo');
const save = document.querySelector('#save');
const load = document.querySelector('#load');
const reset = document.querySelector('#reset');
const quickMenu = document.querySelector('#quick-menu');
const metrics = {
  trust: document.querySelector('#metric-trust'),
  heat: document.querySelector('#metric-heat'),
  debt: document.querySelector('#metric-debt'),
};
const saveKey = 'gneh:no-clean-getaway:visual-novel:v1';

if (
  !root ||
  !content ||
  !choices ||
  !route ||
  !routeTitle ||
  !beatCounter ||
  !status ||
  !dialogue ||
  !next ||
  !undo ||
  !redo ||
  !save ||
  !load ||
  !reset ||
  !quickMenu ||
  Object.values(metrics).some((metric) => !metric)
) {
  throw new Error('Missing visual-novel application shell');
}

document.title = project.title;
document.documentElement.dataset.gnehEnvironment = 'visual-novel';

let beat = 0;
let currentRoute = '';
let contentMount;
let choiceMount;

const yardRoutes = new Set([
  'Start',
  'MotelMoney',
  'FirstTow',
  'EthicalRoute',
  'FavorRoute',
  'ContractRoute',
  'LateConfession',
  'InterviewMorning',
  'PredatoryPlan',
  'TermsAndConditions',
  'BusinessPartners',
  'WomenOwned',
]);
const dawnRoutes = new Set(['BetterThings', 'KeyReturned', 'HonestWreck']);

function text(nodes) {
  return nodes.map((node) => (node.text ?? '') + text(node.children ?? [])).join('');
}

// This is the same beat-planning boundary used by the editable gneh visual-novel
// environment: narrative nodes advance one at a time; decisions appear at the end.
function visualNovelView(view) {
  const actions = [];
  const body = view.filter((node) => {
    if (node.kind === 'choice' || node.kind === 'button') {
      actions.push(node);
      return false;
    }
    // Current Inkdown wraps a standalone wiki choice in a paragraph. Unwrap
    // those direct action paragraphs while leaving actions inside regions in
    // the narrative beat where their reactive content belongs.
    if (
      node.kind === 'paragraph' &&
      node.children?.length &&
      node.children.every((child) => child.kind === 'choice' || child.kind === 'button')
    ) {
      actions.push(...node.children);
      return false;
    }
    return true;
  });
  return {
    beats: body.filter((node) => text([node]).trim() || node.kind === 'image').map((node) => [node]),
    choices: actions,
  };
}

function announce(message, error = false) {
  status.textContent = message;
  status.toggleAttribute('data-error', error);
}

function passageTitle() {
  const fragment = story.passages.get(story.current);
  return String(fragment?.metadata.title ?? story.current).replace(/^.*?\s\/\s/, '');
}

function updateScene() {
  const current = story.current;
  root.dataset.scene = dawnRoutes.has(current) ? 'dawn' : yardRoutes.has(current) ? 'yard' : 'kitchen';
}

function updateCast() {
  const speaker = content.querySelector('.gneh-speaker')?.textContent?.trim().toLowerCase() ?? '';
  root.dataset.activeCharacter = speaker.includes('mars')
    ? 'mars'
    : speaker.includes('lenora')
      ? 'lenora'
      : speaker.includes('jules')
        ? 'jules'
        : 'narrator';
}

function render(view) {
  if (currentRoute !== story.current) {
    currentRoute = story.current;
    beat = 0;
  }

  const plan = visualNovelView(view);
  const beats = plan.beats.length ? plan.beats : [[]];
  beat = Math.min(beat, beats.length - 1);
  const atDecision = beat === beats.length - 1;

  if (contentMount) renderer.update(contentMount, beats[beat]);
  else contentMount = renderer.mount(content, beats[beat]);
  if (choiceMount) renderer.update(choiceMount, atDecision ? plan.choices : []);
  else choiceMount = renderer.mount(choices, atDecision ? plan.choices : []);

  const state = story.state;
  route.textContent = story.current.replace(/([a-z])([A-Z])/g, '$1 $2');
  routeTitle.textContent = passageTitle();
  beatCounter.textContent = `${String(beat + 1).padStart(2, '0')} / ${String(beats.length).padStart(2, '0')}`;
  metrics.trust.textContent = String(state.trust);
  metrics.heat.textContent = String(state.heat);
  metrics.debt.textContent = `$${state.debt}`;
  next.disabled = atDecision;
  next.hidden = atDecision;
  undo.disabled = !story.canUndo;
  redo.disabled = !story.canRedo;
  load.disabled = localStorage.getItem(saveKey) === null;
  choices.toggleAttribute('data-visible', atDecision && plan.choices.length > 0);
  dialogue.toggleAttribute('data-decision', atDecision && plan.choices.length > 0);
  updateScene();
  updateCast();
}

function advance() {
  const plan = visualNovelView(story.view);
  const count = Math.max(plan.beats.length, 1);
  if (beat >= count - 1) return;
  beat++;
  render(story.view);
}

next.addEventListener('click', advance);
dialogue.addEventListener('click', (event) => {
  if (event.target.closest('a, button')) return;
  advance();
});

undo.addEventListener('click', () => {
  if (story.undo()) announce('Rewound one decision.');
});
redo.addEventListener('click', () => {
  if (story.redo()) announce('Restored one decision.');
});
save.addEventListener('click', () => {
  localStorage.setItem(saveKey, story.save());
  announce('QUICK SAVE complete.');
  render(story.view);
});
load.addEventListener('click', () => {
  const snapshot = localStorage.getItem(saveKey);
  if (!snapshot) return;
  currentRoute = '';
  story.load(snapshot);
  announce('QUICK LOAD complete.');
});
reset.addEventListener('click', () => {
  currentRoute = '';
  story.reset();
  announce('Returned to 2:17 a.m.');
});
quickMenu.addEventListener('click', () => root.toggleAttribute('data-menu-open'));

document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === ' ' || event.key === 'Enter') {
    if (document.activeElement?.matches('button, a')) return;
    event.preventDefault();
    advance();
  } else if (event.key === 'ArrowLeft' && !undo.disabled) undo.click();
  else if (event.key === 'ArrowRight') advance();
  else if (event.key.toLowerCase() === 's') save.click();
  else if (event.key.toLowerCase() === 'l' && !load.disabled) load.click();
});

const unsubscribe = story.subscribe(render);
window.gnehApp = {
  story,
  environment: 'visual-novel',
  advance,
  dispose() {
    unsubscribe();
    if (contentMount) renderer.dispose(contentMount);
    if (choiceMount) renderer.dispose(choiceMount);
    story.dispose();
    delete document.documentElement.dataset.gnehEnvironment;
  },
};

if (import.meta.hot) import.meta.hot.dispose(() => window.gnehApp.dispose());
