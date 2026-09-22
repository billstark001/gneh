import { mountStory } from '@gneh/renderer-dom';
import { definePassages } from '@gneh/runtime';
import project from '../gneh.config.json';
import arrival from '../story/01-arrival.inkdown';
import caseNotes from '../story/07-case-notes.inkdown';
import definitions from '../story/00-definitions.inkdown';
import endings from '../story/06-endings.inkdown';
import offer from '../story/04-the-offer.inkdown';
import sisterShift from '../story/03-sister-shift.inkdown';
import theCall from '../story/05-the-call.inkdown';
import theCircle from '../story/02-the-circle.inkdown';
import './style.css';

const host = document.querySelector('#story');
const route = document.querySelector('#route');
const routeTitle = document.querySelector('#route-title');
const status = document.querySelector('#app-status');
const progress = document.querySelector('#progress-fill');
const metrics = {
  trust: document.querySelector('#metric-trust'),
  heat: document.querySelector('#metric-heat'),
  debt: document.querySelector('#metric-debt'),
};
const undo = document.querySelector('#undo');
const redo = document.querySelector('#redo');
const save = document.querySelector('#save');
const load = document.querySelector('#load');
const reset = document.querySelector('#reset');
const sound = document.querySelector('#sound');
const saveKey = 'gneh:no-clean-getaway:v1';

if (
  !host ||
  !route ||
  !routeTitle ||
  !status ||
  !progress ||
  !metrics.trust ||
  !metrics.heat ||
  !metrics.debt ||
  !undo ||
  !redo ||
  !save ||
  !load ||
  !reset ||
  !sound
) {
  throw new Error('Missing visual novel application shell');
}

const app = mountStory(
  host,
  definePassages(definitions, arrival, theCircle, sisterShift, offer, theCall, endings, caseNotes),
  {
    entry: project.entry,
    state: structuredClone(project.state),
  },
);

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
const endingRoutes = new Set([
  'BetterThings',
  'KeyReturned',
  'TermsAndConditions',
  'BusinessPartners',
  'WomenOwned',
  'HonestWreck',
  'LockedRoom',
]);
const chapters = new Map([
  ['Start', 0],
  ['OpenDoor', 1],
  ['MakeHerAsk', 1],
  ['MotelMoney', 1],
  ['WeekOne', 1],
  ['WednesdayCircle', 2],
  ['Kiss', 2],
  ['Apology', 2],
  ['WinArgument', 2],
  ['FirstTow', 3],
  ['EthicalRoute', 3],
  ['FavorRoute', 3],
  ['ContractRoute', 3],
  ['JulesArrives', 4],
  ['GiveCard', 4],
  ['HideCard', 4],
  ['ConfessFear', 4],
  ['LateConfession', 4],
  ['TheCall', 5],
  ['InterviewMorning', 5],
  ['PayDeposit', 6],
  ['LegitimatePlan', 6],
  ['PredatoryPlan', 6],
  ['Rupture', 6],
  ['Justify', 6],
]);

document.title = project.title;

function announce(message) {
  status.textContent = message;
}

function titleForCurrent() {
  const heading = host.querySelector('h1, h2');
  return heading?.textContent?.trim() || 'No Clean Getaway';
}

function updateChrome() {
  const current = app.story.current;
  const state = app.story.state;
  const chapter = endingRoutes.has(current) ? 7 : (chapters.get(current) ?? 5);

  document.body.dataset.scene = dawnRoutes.has(current) ? 'dawn' : yardRoutes.has(current) ? 'yard' : 'kitchen';
  document.body.dataset.ending = endingRoutes.has(current) ? 'true' : 'false';
  route.textContent = current.replace(/([a-z])([A-Z])/g, '$1 $2');
  routeTitle.textContent = titleForCurrent();
  metrics.trust.textContent = String(state.trust);
  metrics.heat.textContent = String(state.heat);
  metrics.debt.textContent = `$${state.debt}`;
  progress.style.width = `${Math.min(100, (chapter / 7) * 100)}%`;
  undo.disabled = !app.story.canUndo;
  redo.disabled = !app.story.canRedo;
  load.disabled = localStorage.getItem(saveKey) === null;
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
}

undo.addEventListener('click', () => {
  if (app.story.undo()) announce('One bad decision, reconsidered.');
});

redo.addEventListener('click', () => {
  if (app.story.redo()) announce('The decision returns with all its consequences.');
});

save.addEventListener('click', () => {
  localStorage.setItem(saveKey, app.story.save());
  announce('Case file saved locally.');
  updateChrome();
});

load.addEventListener('click', () => {
  const snapshot = localStorage.getItem(saveKey);
  if (!snapshot) return;
  app.story.load(snapshot);
  announce('Case file restored.');
});

reset.addEventListener('click', () => {
  app.story.reset();
  announce('Back to 2:17 a.m. Nothing has been learned.');
});

sound.addEventListener('click', () => {
  const muted = sound.getAttribute('aria-pressed') === 'true';
  sound.setAttribute('aria-pressed', String(!muted));
  sound.textContent = muted ? 'Ambient: on' : 'Ambient: off';
  announce(muted ? 'Imaginary rain restored.' : 'Imaginary rain muted.');
});

document.addEventListener('keydown', (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key.toLowerCase() === 's') save.click();
  if (event.key.toLowerCase() === 'l' && !load.disabled) load.click();
  if (event.key === 'ArrowLeft' && !undo.disabled) undo.click();
  if (event.key === 'ArrowRight' && !redo.disabled) redo.click();
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
