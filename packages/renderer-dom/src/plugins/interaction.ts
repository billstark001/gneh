import {
  activationFeature,
  buttonTypeFeature,
  choiceTargetFeature,
  regionNameFeature,
} from '../features/interaction.js';
import { metadataFeature } from '../features/metadata.js';
import { kindElementRule } from '../rules.js';
import type { DOMPlugin } from '../types.js';

export function interactionDOM(): DOMPlugin {
  const metadata = metadataFeature();

  return {
    name: 'interaction',
    rules: [
      kindElementRule('region', 'section', [metadata, regionNameFeature()]),
      kindElementRule('choice', 'a', [metadata, choiceTargetFeature(), activationFeature()]),
      kindElementRule('button', 'button', [metadata, buttonTypeFeature(), activationFeature()]),
    ],
  };
}
