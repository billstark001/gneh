import type { ParsedPassage, Span } from '@gneh/core';
import { parseSugarExpression } from '@gneh/expression';

interface WidgetMacroNode {
  type: 'macro';
  name: string;
  args: string;
  start: number;
  end: number;
  fullEnd: number;
  closing?: { start: number };
  children: WidgetCSTNode[];
}

interface WidgetTextNode {
  type: 'text';
}

type WidgetCSTNode = WidgetMacroNode | WidgetTextNode;

export interface SugarcastWidgetSource {
  name: string;
  container: boolean;
  body: string;
  bodyOffset: number;
  source: string;
  span: Span;
  scope: 'module' | 'lexical';
}

export function widgetHeader(source: string): { name: string; container: boolean } | undefined {
  const match = /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')(?:\s+(container))?\s*$/i.exec(source.trim());
  if (!match) return;
  const name = parseSugarExpression(match[1]).ast;
  if (name.type !== 'Literal' || typeof name.value !== 'string') return;
  return { name: name.value.toLowerCase(), container: !!match[2] };
}

export function discoverWidgets(
  passages: ParsedPassage[],
  file: string,
  parse: (source: string) => { children: WidgetCSTNode[] },
): Map<string, SugarcastWidgetSource> {
  const widgets = new Map<string, SugarcastWidgetSource>();
  for (const passage of passages) {
    const document = parse(passage.body);
    const visit = (nodes: WidgetCSTNode[], depth: number) => {
      for (const node of nodes) {
        if (node.type !== 'macro') continue;
        if (node.name.toLowerCase() === 'widget' && node.closing) {
          const header = widgetHeader(node.args);
          if (header && !widgets.has(header.name))
            widgets.set(header.name, {
              ...header,
              body: passage.body.slice(node.end, node.closing.start),
              bodyOffset: passage.bodyOffset + node.end,
              source: passage.body.slice(node.start, node.fullEnd),
              span: { file, start: passage.bodyOffset + node.start, end: passage.bodyOffset + node.fullEnd },
              scope: depth === 0 ? 'module' : 'lexical',
            });
          continue;
        }
        visit(node.children, depth + 1);
      }
    };
    visit(document.children, 0);
  }
  return widgets;
}

export function referencedWidgets(
  source: string,
  widgets: ReadonlyMap<string, SugarcastWidgetSource>,
  parse: (source: string) => { children: WidgetCSTNode[] },
): Set<string> {
  const references = new Set<string>();
  const visit = (nodes: WidgetCSTNode[]) => {
    for (const node of nodes) {
      if (node.type !== 'macro') continue;
      const name = node.name.toLowerCase();
      if (name === 'widget') continue;
      if (widgets.has(name)) references.add(name);
      visit(node.children);
    }
  };
  visit(parse(source).children);
  return references;
}
