import type { View } from '@gneh/core';
import type { DOMBinding, DOMContext, DOMRule } from './types.js';

export interface ElementFeatureBinding {
  update(view: View, previous?: View): void;
  dispose?(): void;
}

export interface ElementFeature {
  attach(element: HTMLElement, context: DOMContext): ElementFeatureBinding;
}

export type DOMTagName = keyof HTMLElementTagNameMap;

export type DOMTagResolver = DOMTagName | ((view: View) => DOMTagName);

export interface ElementRuleOptions {
  id: string;
  match(view: View): boolean;
  tag: DOMTagResolver;
  children?: boolean;
  shape?: (view: View) => string;
  features?: readonly ElementFeature[];
}

export function bindElementFeatures(
  element: HTMLElement,
  context: DOMContext,
  features: readonly ElementFeature[],
): readonly ElementFeatureBinding[] {
  return features.map((feature) => feature.attach(element, context));
}

export function updateElementFeatures(bindings: readonly ElementFeatureBinding[], view: View, previous?: View): void {
  for (const binding of bindings) binding.update(view, previous);
}

export function disposeElementFeatures(bindings: readonly ElementFeatureBinding[]): void {
  for (let index = bindings.length - 1; index >= 0; index--) bindings[index].dispose?.();
}

export function elementRule(options: ElementRuleOptions): DOMRule {
  const resolveTag = (view: View): DOMTagName => (typeof options.tag === 'function' ? options.tag(view) : options.tag);

  return {
    id: options.id,
    match: options.match,
    shape: options.shape ?? ((view) => resolveTag(view)),
    mount(view, context): DOMBinding {
      const element = context.document.createElement(resolveTag(view));
      const bindings = bindElementFeatures(element, context, options.features ?? []);

      return {
        node: element,
        childrenHost: options.children === false ? undefined : element,
        update(next, previous) {
          updateElementFeatures(bindings, next, previous);
        },
        dispose() {
          disposeElementFeatures(bindings);
        },
      };
    },
  };
}

export function kindElementRule(
  kind: string,
  tag: DOMTagResolver,
  features: readonly ElementFeature[] = [],
  children = true,
): DOMRule {
  return elementRule({
    id: `element:${kind}`,
    match: (view) => view.kind === kind,
    tag,
    children,
    features,
  });
}

export function textRule(): DOMRule {
  return {
    id: 'text',
    match: (view) => view.kind === 'text',
    mount(view, context) {
      const node = context.document.createTextNode(view.text ?? '');
      return {
        node,
        update(next) {
          node.textContent = next.text ?? '';
        },
      };
    },
  };
}
