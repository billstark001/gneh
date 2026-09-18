import { GnehError, type View } from '@gneh/core';
import type { DOMPlugin, DOMRule } from './types.js';

export class DOMRuleRegistry {
  private readonly rules: readonly DOMRule[];

  constructor(plugins: readonly DOMPlugin[]) {
    this.rules = plugins.flatMap((plugin) => plugin.rules);
  }

  resolve(view: View): DOMRule {
    for (let index = this.rules.length - 1; index >= 0; index--) {
      const rule = this.rules[index];
      if (rule.match(view)) return rule;
    }

    throw new GnehError('DOM_UNSUPPORTED_VIEW', `No DOM rule registered for ${view.kind}`);
  }
}
