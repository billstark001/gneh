import type { Dialect, ParsedPassage, PassageIR, StoryNode, ViewDeclarationIR } from '@gneh/core';
import type { MarkupParser } from './parser.js';

export function storyCapabilities(
  body: StoryNode[],
  views: Readonly<Record<string, ViewDeclarationIR>> = {},
): string[] {
  const capabilities = new Set<string>();
  function visit(nodes: StoryNode[]) {
    for (const n of nodes) {
      if (n.type === 'button' || n.type === 'region') capabilities.add('live');
      if (n.type === 'interaction' || n.type === 'region-change' || n.type === 'control') capabilities.add('live');
      if (n.type === 'extension') capabilities.add('presentation:' + n.name);
      if (n.type === 'invoke') capabilities.add('runtime-extension:' + n.id);
      if (n.type === 'portal') capabilities.add('shell:' + n.name);
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
  for (const view of Object.values(views)) visit(view.body);
  return [...capabilities];
}

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
    enter: parser.enter,
    effects: parser.effects,
    views: parser.views,
    constants: parser.constants,
    imports: parser.imports,
    exports: parser.exports,
    capabilities: storyCapabilities(body, parser.views),
  };
}
