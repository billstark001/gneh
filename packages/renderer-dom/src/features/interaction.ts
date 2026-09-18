import type { View } from '@gneh/core';
import type { ElementFeature } from '../rules.js';

export function activationFeature(): ElementFeature {
  return {
    attach(element, context) {
      let current: View | undefined;

      const activate = (event: Event) => {
        event.preventDefault();
        try {
          current?.activate?.();
        } catch (error) {
          context.onError(error);
        }
      };

      element.addEventListener('click', activate);

      return {
        update(view) {
          current = view;
        },
        dispose() {
          element.removeEventListener('click', activate);
        },
      };
    },
  };
}

export function regionNameFeature(): ElementFeature {
  return {
    attach(element) {
      return {
        update(view) {
          element.dataset.region = String(view.attrs?.name ?? '');
        },
      };
    },
  };
}

export function choiceTargetFeature(): ElementFeature {
  return {
    attach(element) {
      const anchor = element as HTMLAnchorElement;
      return {
        update(view) {
          anchor.href = `#${encodeURIComponent(String(view.attrs?.target ?? ''))}`;
        },
      };
    },
  };
}

export function buttonTypeFeature(): ElementFeature {
  return {
    attach(element) {
      const button = element as HTMLButtonElement;
      return {
        update() {
          button.type = 'button';
        },
      };
    },
  };
}
