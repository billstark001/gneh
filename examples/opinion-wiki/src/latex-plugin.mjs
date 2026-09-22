import katex from 'katex';
import { formulaSource } from './Formula.mjs';

/** @returns {import('@gneh/renderer-dom').DOMPlugin} */
export function latexDOM() {
  return {
    name: 'opinion-wiki-renderers',
    rules: [
      {
        id: 'opinion-wiki-containers',
        match(view) {
          return ['topic-header', 'callout', 'key-idea', 'flow'].includes(view.kind.slice(10));
        },
        shape(view) {
          return view.kind;
        },
        mount(view, context) {
          const element = context.document.createElement('section');
          const update = (next) => {
            const name = next.kind.slice(10);
            element.dataset.extension = name;
            for (const attribute of ['eyebrow', 'title', 'label', 'steps', 'tone']) {
              const value = next.attrs?.[attribute];
              if (value === undefined) delete element.dataset[attribute];
              else element.dataset[attribute] = String(value);
            }
          };

          update(view);
          return { node: element, childrenHost: element, update };
        },
      },
      {
        id: 'opinion-wiki-latex',
        match(view) {
          return view.kind === 'extension:latex';
        },
        shape() {
          return 'latex';
        },
        mount(view, context) {
          const element = context.document.createElement(view.attrs?.display === false ? 'span' : 'div');
          element.className = 'math-block';

          const update = (next) => {
            const source = String(next.attrs?.source ?? formulaSource(next.attrs?.formula ?? ''));
            const label = String(next.attrs?.label ?? 'Mathematical expression');
            element.setAttribute('role', 'math');
            element.setAttribute('aria-label', label);
            katex.render(source, element, {
              displayMode: next.attrs?.display !== false,
              throwOnError: false,
              strict: 'warn',
              trust: false,
            });
          };

          update(view);
          return { node: element, update };
        },
      },
    ],
  };
}
