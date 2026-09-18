import type { DOMPlugin } from '../types.js';
import { controlsDOM } from './controls.js';
import { coreDOM } from './core.js';
import { interactionDOM } from './interaction.js';
import { presentationDOM } from './presentation.js';

export function defaultDOMPlugins(options: { unsupported?: 'fallback' | 'error' } = {}): readonly DOMPlugin[] {
  return [coreDOM(), interactionDOM(), controlsDOM(), presentationDOM(options)];
}
