import { metadataFeature } from '../features/metadata.js';
import { imageFeature, linkFeature } from '../features/resources.js';
import { elementRule, kindElementRule, textRule, type DOMTagName } from '../rules.js';
import type { DOMPlugin } from '../types.js';

const headingTag = (level: unknown): DOMTagName => {
  const normalized = Math.max(1, Math.min(6, Number(level) || 1));
  return `h${normalized}` as DOMTagName;
};

export function coreDOM(): DOMPlugin {
  const metadata = metadataFeature();

  return {
    name: 'core',
    rules: [
      elementRule({
        id: 'core:fallback',
        match: (view) =>
          view.kind !== 'text' && !view.kind.startsWith('control:') && !view.kind.startsWith('extension:'),
        tag: 'div',
        features: [metadata],
      }),
      kindElementRule('paragraph', 'p', [metadata]),
      kindElementRule('strong', 'strong', [metadata]),
      kindElementRule('emphasis', 'em', [metadata]),
      kindElementRule('strike', 'del', [metadata]),
      kindElementRule('quote', 'blockquote', [metadata]),
      kindElementRule('item', 'li', [metadata]),
      kindElementRule('code', 'code', [metadata]),
      kindElementRule('code-block', 'pre', [metadata]),
      kindElementRule('break', 'br', [metadata], false),
      kindElementRule('rule', 'hr', [metadata], false),
      kindElementRule('link', 'a', [metadata, linkFeature()]),
      kindElementRule('image', 'img', [metadata, imageFeature()], false),
      kindElementRule('span', 'span', [metadata]),
      kindElementRule('group', 'div', [metadata]),
      elementRule({
        id: 'element:heading',
        match: (view) => view.kind === 'heading',
        tag: (view) => headingTag(view.attrs?.level),
        features: [metadata],
      }),
      elementRule({
        id: 'element:list',
        match: (view) => view.kind === 'list',
        tag: (view) => (view.attrs?.ordered ? 'ol' : 'ul'),
        features: [metadata],
      }),
      textRule(),
    ],
  };
}
