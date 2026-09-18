import { metadataFeature } from '../features/metadata.js';
import { bindElementFeatures, disposeElementFeatures, updateElementFeatures } from '../rules.js';
import type { DOMPlugin, ExtensionRenderer } from '../types.js';

export function extensionRenderersPlugin(extensions: Readonly<Record<string, ExtensionRenderer>>): DOMPlugin {
  return {
    name: 'extension-renderers',
    rules: [
      {
        id: 'extension-renderers',
        match(view) {
          if (!view.kind.startsWith('extension:')) return false;
          return typeof extensions[view.kind.slice(10)] === 'function';
        },
        shape: (view) => view.kind,
        mount(view, context) {
          const name = view.kind.slice(10);
          const factory = extensions[name];
          const extension = factory(view, context.document);
          const bindings = bindElementFeatures(extension.element, context, [metadataFeature()]);

          return {
            node: extension.element,
            childrenHost: extension.childrenHost ?? extension.element,
            update(next, previous) {
              updateElementFeatures(bindings, next, previous);
              extension.update?.(next);
            },
            dispose() {
              extension.dispose?.();
              disposeElementFeatures(bindings);
            },
          };
        },
      },
    ],
  };
}
