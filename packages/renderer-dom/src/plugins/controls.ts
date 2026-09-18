import type { View } from '@gneh/core';
import { metadataFeature } from '../features/metadata.js';
import { elementRule, type ElementFeature } from '../rules.js';
import type { DOMPlugin } from '../types.js';

function serializeControlValue(value: unknown): string {
  return JSON.stringify(value) ?? 'undefined';
}

function selectControlFeature(): ElementFeature {
  return {
    attach(element, context) {
      const select = element as HTMLSelectElement;
      let current: View | undefined;
      let signature = '';

      const change = () => {
        let value: unknown = select.value;
        try {
          value = JSON.parse(select.value);
        } catch {}

        try {
          current?.change?.(value);
        } catch (error) {
          context.onError(error);
        }
      };

      select.addEventListener('change', change);

      return {
        update(view) {
          current = view;
          const options = Array.isArray(view.attrs?.options) ? (view.attrs.options as unknown[]) : [];
          const nextSignature = JSON.stringify(options) ?? '';

          if (signature !== nextSignature) {
            signature = nextSignature;
            select.replaceChildren(
              ...options.map((value) => {
                const option = context.document.createElement('option');
                option.value = serializeControlValue(value);
                option.textContent = String(value);
                return option;
              }),
            );
          }

          if (Object.hasOwn(view.attrs ?? {}, 'value')) {
            select.value = serializeControlValue(view.attrs?.value);
          }
        },
        dispose() {
          select.removeEventListener('change', change);
        },
      };
    },
  };
}

function checkboxControl(): DOMPlugin['rules'][number] {
  const metadata = metadataFeature();

  return {
    id: 'control:checkbox',
    match: (view) => view.kind === 'control:checkbox',
    mount(view, context) {
      const element = context.document.createElement('label');
      const input = context.document.createElement('input');
      const content = context.document.createElement('span');
      const metadataBinding = metadata.attach(element, context);
      let current = view;

      input.type = 'checkbox';
      element.append(input, content);

      const change = () => {
        try {
          current.change?.(input.checked);
        } catch (error) {
          context.onError(error);
        }
      };

      input.addEventListener('change', change);

      return {
        node: element,
        childrenHost: content,
        update(next, previous) {
          current = next;
          metadataBinding.update(next, previous);
          input.checked = Boolean(next.attrs?.checked);
        },
        dispose() {
          input.removeEventListener('change', change);
          metadataBinding.dispose?.();
        },
      };
    },
  };
}

export function controlsDOM(): DOMPlugin {
  return {
    name: 'controls',
    rules: [
      elementRule({
        id: 'control:select',
        match: (view) => view.kind === 'control:select',
        tag: 'select',
        children: false,
        features: [metadataFeature(), selectControlFeature()],
      }),
      checkboxControl(),
    ],
  };
}
