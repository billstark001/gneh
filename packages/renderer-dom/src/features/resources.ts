import type { ElementFeature } from '../rules.js';
import { safeURL } from '../safe-url.js';

export function linkFeature(): ElementFeature {
  return {
    attach(element) {
      const anchor = element as HTMLAnchorElement;
      return {
        update(view) {
          const url = safeURL(view.attrs?.href);
          if (url) anchor.setAttribute('href', url);
          else anchor.removeAttribute('href');
          anchor.setAttribute('rel', 'noopener noreferrer');
        },
      };
    },
  };
}

export function imageFeature(): ElementFeature {
  return {
    attach(element) {
      const image = element as HTMLImageElement;
      return {
        update(view) {
          const src = safeURL(view.attrs?.src, true);
          if (src) image.setAttribute('src', src);
          else image.removeAttribute('src');
          image.setAttribute('alt', String(view.attrs?.alt ?? ''));
          image.setAttribute('loading', 'lazy');
        },
      };
    },
  };
}
