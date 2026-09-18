import type { ElementFeature } from '../rules.js';

export function metadataFeature(): ElementFeature {
  return {
    attach(element) {
      return {
        update(view) {
          const attrs = view.attrs ?? {};
          const rawTokens = Array.isArray(attrs.tokens) ? (attrs.tokens as unknown[]) : [];
          const tokens = rawTokens.filter(
            (token: unknown): token is string => typeof token === 'string' && /^[\w-]+$/.test(token),
          );

          element.className = `gneh-${view.kind.replaceAll(':', '-')}`;
          element.dataset.tokens = tokens.join(' ');

          if (typeof attrs.id === 'string') element.dataset.ref = attrs.id;
          else delete element.dataset.ref;
        },
      };
    },
  };
}
