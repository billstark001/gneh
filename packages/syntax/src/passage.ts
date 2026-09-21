import type {
  CallableIR,
  Dialect,
  EffectNode,
  ParsedPassage,
  PassageIR,
  StoryNode,
  ValueCallableBodyIR,
} from '@gneh/core';
import type { MarkupParser } from './parser.js';

/** Derive the host/runtime capabilities reachable from a passage and its nested callables. */
export function storyCapabilities(body: StoryNode[], extra: readonly CallableIR[] = []): string[] {
  const capabilities = new Set<string>();
  function visitCallable(callable: CallableIR) {
    if (callable.phase === 'view') visit(callable.body as StoryNode[]);
    else if (callable.phase === 'effect') visitEffects(callable.body as EffectNode[]);
    else visitEffects((callable.body as ValueCallableBodyIR).effects);
  }
  function visitEffects(effects: EffectNode[]) {
    for (const effect of effects) {
      if (effect.type === 'assign-callable' || effect.type === 'publish-callable') visitCallable(effect.callable);
      else if (effect.type === 'call' && effect.call.callee.type === 'inline')
        visitCallable(effect.call.callee.callable);
      else if (effect.type === 'if') {
        visitEffects(effect.yes);
        visitEffects(effect.no);
      } else if (effect.type === 'each') visitEffects(effect.body);
    }
  }
  function visit(nodes: StoryNode[]) {
    for (const n of nodes) {
      if (n.type === 'button' || n.type === 'region') capabilities.add('live');
      if (n.type === 'interaction' || n.type === 'region-change' || n.type === 'control') capabilities.add('live');
      if (n.type === 'extension') capabilities.add('presentation:' + n.name);
      if (n.type === 'invoke') capabilities.add('runtime-extension:' + n.id);
      if (n.type === 'portal') capabilities.add('shell:' + n.name);
      if (n.type === 'callable') visitCallable(n.callable);
      if (n.type === 'effect') visitEffects(n.effects);
      if ((n.type === 'button' || n.type === 'control') && n.action.callee.type === 'inline')
        visitCallable(n.action.callee.callable);
      if (n.type === 'if') {
        visit(n.yes);
        visit(n.no);
      } else {
        if ('children' in n) visit(n.children);
        if (n.type === 'interaction') visit(n.label);
        if (n.type === 'control') visit(n.label);
      }
    }
  }
  visit(body);
  for (const callable of extra) visitCallable(callable);
  return [...capabilities];
}

/** Lower a container passage through a configured markup parser into the shared PassageIR shape. */
export function basePassage(parsed: ParsedPassage, dialect: Dialect, parser: MarkupParser): PassageIR {
  const body = parser.blocks(parsed.body, parsed.bodyOffset);
  return {
    id: parsed.id,
    name: parsed.name,
    dialect,
    metadata: parsed.metadata,
    source: parsed.body,
    span: parsed.span,
    body,
    evaluation: parser.evaluation,
    constants: parser.constants,
    capabilities: storyCapabilities(body),
  };
}
