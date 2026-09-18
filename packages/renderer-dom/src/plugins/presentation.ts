import { GnehError, type View } from '@gneh/core';
import { metadataFeature } from '../features/metadata.js';
import {
  bindElementFeatures,
  disposeElementFeatures,
  elementRule,
  type ElementFeature,
  updateElementFeatures,
} from '../rules.js';
import type { DOMPlugin, DOMRule } from '../types.js';

const sectionExtensions = new Set(['box', 'scene', 'note', 'choice-group', 'status']);

function extensionName(view: View): string {
  return view.kind.startsWith('extension:') ? view.kind.slice(10) : '';
}

function presentationStyleFeature(): ElementFeature {
  return {
    attach(element) {
      return {
        update(view) {
          const property = String(view.attrs?.property ?? '');
          const value = view.attrs?.value;
          const cssValue = Array.isArray(value) ? value.join(' ') : String(value ?? '');

          element.style.color = '';
          element.style.fontFamily = '';
          element.style.fontSize = '';
          element.style.borderStyle = '';
          element.style.borderColor = '';
          element.style.borderRadius = '';
          element.style.fontWeight = '';
          element.style.fontStyle = '';
          element.style.textDecoration = '';
          delete element.dataset.style;

          if (property === 'foreground') element.style.color = String(value ?? '');
          else if (property === 'font-family') element.style.fontFamily = cssValue;
          else if (property === 'scale') {
            const scale = Number(value);
            element.style.fontSize = Number.isFinite(scale) ? `${scale * 100}%` : '';
          } else if (property === 'border-style') element.style.borderStyle = cssValue;
          else if (property === 'border-color') element.style.borderColor = cssValue;
          else if (property === 'corner-radius') element.style.borderRadius = cssValue;
          else if (property === 'text-style') {
            const style = String(value ?? '').toLowerCase();
            element.style.fontWeight = style.includes('bold') ? 'bold' : '';
            element.style.fontStyle = style.includes('italic') ? 'italic' : '';
            element.style.textDecoration = style.includes('underline')
              ? 'underline'
              : style.includes('strike')
                ? 'line-through'
                : '';
            element.dataset.style = style;
          }
        },
      };
    },
  };
}

function sectionExtensionRule(id: string, match: (name: string) => boolean): DOMRule {
  return {
    id,
    match: (view) => view.kind.startsWith('extension:') && match(extensionName(view)),
    shape: (view) => view.kind,
    mount(view, context) {
      const element = context.document.createElement('section');
      const bindings = bindElementFeatures(element, context, [metadataFeature()]);

      return {
        node: element,
        childrenHost: element,
        update(next, previous) {
          element.dataset.extension = extensionName(next);
          updateElementFeatures(bindings, next, previous);
        },
        dispose() {
          disposeElementFeatures(bindings);
        },
      };
    },
  };
}

function dialogueRule(): DOMRule {
  return {
    id: 'extension:dialogue',
    match: (view) => view.kind === 'extension:dialogue',
    mount(view, context) {
      const element = context.document.createElement('section');
      const speaker = context.document.createElement('strong');
      const content = context.document.createElement('div');
      const bindings = bindElementFeatures(element, context, [metadataFeature()]);

      speaker.className = 'gneh-speaker';
      element.dataset.extension = 'dialogue';
      element.append(speaker, content);

      return {
        node: element,
        childrenHost: content,
        update(next, previous) {
          updateElementFeatures(bindings, next, previous);
          speaker.textContent = typeof next.attrs?.speaker === 'string' ? next.attrs.speaker : '';
        },
        dispose() {
          disposeElementFeatures(bindings);
        },
      };
    },
  };
}

function unsupportedExtensionRule(unsupported: 'fallback' | 'error'): DOMRule {
  if (unsupported === 'fallback') {
    return sectionExtensionRule('extension:fallback', () => true);
  }

  return {
    id: 'extension:unsupported',
    match: (view) => view.kind.startsWith('extension:'),
    shape: (view) => view.kind,
    mount(view) {
      const name = extensionName(view);
      throw new GnehError('PRESENTATION_UNSUPPORTED', `No DOM presenter registered for ${name}`);
    },
  };
}

export function presentationDOM(options: { unsupported?: 'fallback' | 'error' } = {}): DOMPlugin {
  const unsupported = options.unsupported ?? 'fallback';

  return {
    name: 'presentation',
    rules: [
      unsupportedExtensionRule(unsupported),
      sectionExtensionRule('extension:section', (name) => sectionExtensions.has(name)),
      dialogueRule(),
      elementRule({
        id: 'extension:presentation',
        match: (view) => view.kind === 'extension:presentation',
        tag: 'span',
        features: [metadataFeature(), presentationStyleFeature()],
      }),
    ],
  };
}
