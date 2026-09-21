import type { View } from '@gneh/core';
import type { PassageSet } from '@gneh/runtime';
import { DOMRenderer, type DOMMount } from '@gneh/renderer-dom';
import { createStory, type StoryAppOptions } from './story';

type Environment = 'wiki' | 'story-flow' | 'visual-novel';

export interface AppOptions extends StoryAppOptions {
  environment?: Environment;
}

function text(nodes: View[]): string {
  return nodes.map((node) => (node.text ?? '') + text(node.children ?? [])).join('');
}

function visualNovelView(view: View[]): { beats: View[][]; choices: View[] } {
  const choices: View[] = [];
  const body = view
    .map((node) => {
      if (node.kind === 'choice' || node.kind === 'button') {
        choices.push(node);
        return undefined;
      }
      return node;
    })
    .filter(Boolean) as View[];
  return {
    beats: body.filter((node) => text([node]).trim() || node.kind === 'image').map((node) => [node]),
    choices,
  };
}

/** Application code, intentionally kept in the generated project for editing or replacement. */
export function createApp(host: HTMLElement, passages: PassageSet, options: AppOptions) {
  const story = createStory(passages, options);
  const renderer = new DOMRenderer({
    onError(error) {
      status.textContent = error instanceof Error ? error.message : String(error);
      status.dataset.error = '';
    },
  });
  let environment: Environment = options.environment ?? 'story-flow';
  const page = document.documentElement;
  const previousPageEnvironment = page.dataset.gnehEnvironment;
  page.dataset.gnehEnvironment = environment;
  let beat = 0;
  let route = '';
  let contentMount: DOMMount | undefined;
  let choiceMount: DOMMount | undefined;

  const root = document.createElement('div');
  root.className = 'gneh-app';
  root.dataset.environment = environment;
  root.innerHTML = `<header class="toolbar">
    <strong>GNĒH <small>editable starter</small></strong>
    <select aria-label="Presentation environment">
      <option value="wiki">Wiki</option>
      <option value="story-flow">Story flow</option>
      <option value="visual-novel">Visual novel</option>
    </select>
    <button data-command="undo">Undo</button><button data-command="redo">Redo</button>
    <button data-command="save">Save</button><button data-command="load">Load</button>
  </header>
  <div class="layout"><aside><p>PASSAGES</p><nav></nav></aside>
    <main><div class="route"></div><article></article><div class="choices"></div>
      <footer><span class="counter"></span><button data-command="next">Next</button></footer>
      <output class="status" aria-live="polite"></output>
    </main></div>`;
  host.replaceChildren(root);

  const select = root.querySelector('select')!;
  const nav = root.querySelector('nav')!;
  const article = root.querySelector('article')!;
  const choices = root.querySelector<HTMLElement>('.choices')!;
  const status = root.querySelector<HTMLOutputElement>('.status')!;
  const counter = root.querySelector<HTMLElement>('.counter')!;
  const next = root.querySelector<HTMLButtonElement>('[data-command=next]')!;
  const undo = root.querySelector<HTMLButtonElement>('[data-command=undo]')!;
  const redo = root.querySelector<HTMLButtonElement>('[data-command=redo]')!;
  const buttons = new Map<string, HTMLButtonElement>();
  select.value = environment;

  for (const fragment of story.passages.values()) {
    if (fragment.metadata.nav === false || (Array.isArray(fragment.metadata.params) && fragment.metadata.params.length))
      continue;
    const button = document.createElement('button');
    button.textContent = String(fragment.metadata.title ?? fragment.id);
    button.onclick = () => story.navigate(fragment.id);
    nav.append(button);
    buttons.set(fragment.id, button);
  }

  function render(view: View[]) {
    if (route !== story.current) {
      route = story.current;
      beat = 0;
    }
    root.querySelector('.route')!.textContent = story.current;
    const plan = visualNovelView(view);
    const visualNovel = environment === 'visual-novel';
    const beats = plan.beats.length ? plan.beats : [[]];
    beat = Math.min(beat, beats.length - 1);
    const body = visualNovel ? beats[beat] : view;
    const actions = visualNovel && beat === beats.length - 1 ? plan.choices : [];
    if (contentMount) renderer.update(contentMount, body);
    else contentMount = renderer.mount(article, body);
    if (choiceMount) renderer.update(choiceMount, actions);
    else choiceMount = renderer.mount(choices, actions);
    counter.textContent = visualNovel ? `${beat + 1} / ${beats.length}` : '';
    next.disabled = !visualNovel || beat >= beats.length - 1;
    undo.disabled = !story.canUndo;
    redo.disabled = !story.canRedo;
    for (const [id, button] of buttons) button.setAttribute('aria-current', id === story.current ? 'page' : 'false');
  }

  select.onchange = () => {
    environment = select.value as Environment;
    page.dataset.gnehEnvironment = environment;
    root.dataset.environment = environment;
    beat = 0;
    render(story.view);
  };
  next.onclick = () => {
    beat++;
    render(story.view);
  };
  undo.onclick = () => story.undo();
  redo.onclick = () => story.redo();
  root.querySelector<HTMLButtonElement>('[data-command=save]')!.onclick = () => {
    localStorage.setItem('gneh:save', story.save());
    status.textContent = 'Saved.';
  };
  root.querySelector<HTMLButtonElement>('[data-command=load]')!.onclick = () => {
    const saved = localStorage.getItem('gneh:save');
    if (saved) story.load(saved);
  };
  const unsubscribe = story.subscribe(render);

  return {
    story,
    dispose() {
      unsubscribe();
      if (contentMount) renderer.dispose(contentMount);
      if (choiceMount) renderer.dispose(choiceMount);
      story.dispose();
      root.remove();
      if (previousPageEnvironment) page.dataset.gnehEnvironment = previousPageEnvironment;
      else delete page.dataset.gnehEnvironment;
    },
  };
}
