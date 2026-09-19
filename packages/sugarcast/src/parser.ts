import { GnehError, type EffectNode, type ParseResult, type StoryNode, type Span } from '@gneh/core';
import { splitPassages, diag } from '@gneh/source';
import { parseSugarExpression } from '@gneh/expression';
import {
  caseInsensitiveMacroName,
  MacroLoweringRegistry,
  MarkupParser,
  balanced,
  basePassage,
  splitTopLevel,
  type MacroLowering,
  type SpecialReader,
} from '@gneh/syntax';

export interface SugarcastMacroToken {
  name: string;
  args: string;
  start: number;
  argStart: number;
  end: number;
}

export interface SugarcastTextCST {
  type: 'text';
  value: string;
  start: number;
  end: number;
}

export interface SugarcastMacroCST extends SugarcastMacroToken {
  type: 'macro';
  fullEnd: number;
  closing?: SugarcastMacroToken;
  children: SugarcastCSTNode[];
}

export type SugarcastCSTNode = SugarcastTextCST | SugarcastMacroCST;

export interface SugarcastDocumentCST {
  type: 'document';
  source: string;
  children: SugarcastCSTNode[];
  diagnostics: { code: string; message: string; start: number; end: number }[];
}

export interface SugarcastMacroMeta {
  container?: boolean;
  sections?: readonly string[];
}

export type SugarcastLowerings = MacroLoweringRegistry<SugarcastMacroCST, SugarcastMacroMeta>;

export function readSugarcastMacro(source: string, index: number): SugarcastMacroToken | undefined {
  const match = /^<<\s*(\/?[A-Za-z][\w-]*|=)\s*/.exec(source.slice(index));
  if (!match) return;
  let i = index + match[0].length;
  const argStart = i;
  while (i < source.length) {
    const c = source[i];
    if (source.startsWith('>>', i))
      return {
        name: match[1],
        args: source.slice(argStart, i).trim(),
        start: index,
        argStart,
        end: i + 2,
      };
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i++] === q) break;
      }
      continue;
    }
    if ('([{'.includes(c)) {
      i = balanced(source, i).end;
      continue;
    }
    i++;
  }
  throw new GnehError('SUGARCAST_MACRO', 'Unclosed <<macro>>');
}

/**
 * Lossless, registry-independent SugarCube macro structure. Matching closing tags
 * establish containers; an unpaired opening remains a leaf because only a semantic
 * lowering can know whether that name normally requires a body.
 */
export function parseSugarcastCST(source: string): SugarcastDocumentCST {
  const tokens: SugarcastMacroToken[] = [];
  const diagnostics: SugarcastDocumentCST['diagnostics'] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf('<<', cursor);
    if (start < 0) break;
    try {
      const token = readSugarcastMacro(source, start);
      if (token) {
        tokens.push(token);
        cursor = token.end;
      } else cursor = start + 2;
    } catch (error) {
      diagnostics.push({
        code: error instanceof GnehError ? error.code : 'SUGARCAST_CST',
        message: error instanceof Error ? error.message : String(error),
        start,
        end: source.length,
      });
      cursor = start + 2;
    }
  }
  const matchingClose = (openingIndex: number, endIndex: number): number | undefined => {
    const name = tokens[openingIndex].name.toLowerCase();
    let depth = 1;
    for (let index = openingIndex + 1; index < endIndex; index++) {
      const token = tokens[index];
      const canonical = token.name.replace(/^\//, '').toLowerCase();
      if (canonical !== name) continue;
      if (token.name.startsWith('/')) depth--;
      else depth++;
      if (depth === 0) return index;
    }
  };
  const structure = (
    startIndex: number,
    endIndex: number,
    contentStart: number,
    contentEnd: number,
  ): SugarcastCSTNode[] => {
    const children: SugarcastCSTNode[] = [];
    let textStart = contentStart;
    const text = (end: number) => {
      if (end > textStart)
        children.push({
          type: 'text',
          value: source.slice(textStart, end),
          start: textStart,
          end,
        });
    };
    for (let index = startIndex; index < endIndex; index++) {
      const token = tokens[index];
      text(token.start);
      if (token.name.startsWith('/')) {
        const canonical = token.name.slice(1).toLowerCase();
        diagnostics.push({
          code: 'SUGARCAST_CST_NESTING',
          message: `Unexpected closing macro <</${canonical}>>.`,
          start: token.start,
          end: token.end,
        });
        children.push({ ...token, type: 'macro', fullEnd: token.end, children: [] });
        textStart = token.end;
        continue;
      }
      const closeIndex = matchingClose(index, endIndex);
      if (closeIndex === undefined) {
        children.push({ ...token, type: 'macro', fullEnd: token.end, children: [] });
        textStart = token.end;
        continue;
      }
      const closing = tokens[closeIndex];
      children.push({
        ...token,
        type: 'macro',
        fullEnd: closing.end,
        closing,
        children: structure(index + 1, closeIndex, token.end, closing.start),
      });
      index = closeIndex;
      textStart = closing.end;
    }
    text(contentEnd);
    return children;
  };
  return {
    type: 'document',
    source,
    children: structure(0, tokens.length, 0, source.length),
    diagnostics,
  };
}

function sugarcastContainerNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/<<\s*\/([A-Za-z][\w-]*)\s*>>/g)) names.add(match[1].toLowerCase());
  return names;
}

export function readSugarcastBlock(
  source: string,
  opening: SugarcastMacroToken,
  registry: SugarcastLowerings,
  containers = sugarcastContainerNames(source),
): {
  sections: {
    tag: SugarcastMacroToken;
    body: string;
    base: number;
  }[];
  end: number;
} {
  let i = opening.end;
  const openingName = registry.normalize(opening.name);
  const sectionNames = new Set((registry.resolve(openingName)?.meta?.sections ?? []).map(registry.normalize));
  const stack = [openingName];
  const sections: {
    tag: SugarcastMacroToken;
    body: string;
    base: number;
  }[] = [];
  let current = opening,
    bodyStart = i;
  while (i < source.length) {
    const macroStart = source.indexOf('<<', i);
    const codeStart = source.indexOf('`', i);
    if (codeStart >= 0 && (macroStart < 0 || codeStart < macroStart)) {
      const codeEnd = source.indexOf('`', codeStart + 1);
      i = codeEnd < 0 ? source.length : codeEnd + 1;
      continue;
    }
    if (macroStart < 0) break;
    const m = readSugarcastMacro(source, macroStart);
    if (!m) {
      i = macroStart + 2;
      continue;
    }
    i = m.end;
    if (m.name.startsWith('/')) {
      const closing = registry.normalize(m.name.slice(1));
      if (closing !== stack[stack.length - 1])
        throw new GnehError('SUGARCAST_NESTING', `Expected <</${stack[stack.length - 1]}>>, got <<${m.name}>>`);
      stack.pop();
      if (!stack.length) {
        sections.push({ tag: current, body: source.slice(bodyStart, m.start), base: bodyStart });
        return { sections, end: m.end };
      }
    } else if (stack.length === 1 && sectionNames.has(registry.normalize(m.name))) {
      sections.push({ tag: current, body: source.slice(bodyStart, m.start), base: bodyStart });
      current = m;
      bodyStart = m.end;
    } else if (containers.has(registry.normalize(m.name))) stack.push(registry.normalize(m.name));
  }
  throw new GnehError('SUGARCAST_CLOSE', `Missing <</${opening.name}>>`);
}

/** Keep an inline container together when Markdown paragraph rules see a blank line. */
function extendParagraph(source: string, start: number, initialEnd: number, registry: SugarcastLowerings): number {
  let end = initialEnd;
  let cursor = start;
  const containers = sugarcastContainerNames(source);
  while (cursor < end) {
    const index = source.indexOf('<<', cursor);
    if (index < 0 || index >= end) break;
    const opening = readSugarcastMacro(source, index);
    if (!opening) {
      cursor = index + 2;
      continue;
    }
    if (containers.has(registry.normalize(opening.name))) {
      const containerEnd = readSugarcastBlock(source, opening, registry, containers).end;
      end = Math.max(end, containerEnd);
      cursor = containerEnd;
    } else cursor = opening.end;
  }
  return end;
}

function expr(source: string, span: Span) {
  return parseSugarExpression(source, span);
}

function firstString(
  source: string,
  p: MarkupParser,
  start: number,
): {
  value: string;
  rest: string;
} {
  const m = /^("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*/.exec(source);
  if (!m) p.error('SUGARCAST_LITERAL', 'Expected a literal string argument.', start);
  const ast = parseSugarExpression(m[1]).ast;
  if (ast.type !== 'Literal' || typeof ast.value !== 'string') p.error('SUGARCAST_LITERAL', 'Expected string', start);
  return { value: ast.value as string, rest: source.slice(m[0].length) };
}

function actionBody(source: string, base: number, p: MarkupParser, registry: SugarcastLowerings): EffectNode[] {
  let i = 0;
  const bodyEffects: EffectNode[] = [];
  while (i < source.length) {
    if (/\s/.test(source[i])) {
      i++;
      continue;
    }
    const m = readSugarcastMacro(source, i);
    if (!m)
      p.error(
        'SUGARCAST_ACTION',
        'Button bodies contain <<set>>, <<run>> or <<goto>> in the portable profile.',
        base + i,
      );
    const result = registry.lower(m.name, {
      source,
      index: i,
      base,
      parser: p,
      inline: true,
      node: { ...m, type: 'macro', fullEnd: m.end, children: [] },
    });
    const effects = result?.nodes.filter((node) => node.type === 'effect') ?? [];
    if (!result || effects.length !== result.nodes.length)
      p.error(
        'SUGARCAST_ACTION',
        `<<${m.name}>> is not an effect macro and cannot be used in an event body.`,
        base + i,
        base + m.end,
      );
    for (const node of effects) bodyEffects.push(...node.effects);
    i = result.end;
  }
  return bodyEffects;
}

const expandSugarcast: MacroLowering<SugarcastMacroCST, SugarcastMacroMeta> = ({
  source,
  index,
  base,
  parser: p,
  inline,
  node: m,
  name,
  lowerings: registry,
}) => {
  const span = p.span(base + index, base + m.end);
  switch (name) {
    case 'set':
    case 'run':
      return {
        nodes: [
          {
            type: 'effect',
            effects: splitTopLevel(m.args, ';')
              .filter((part) => part.trim())
              .map((part) => ({
                type: 'expression' as const,
                expression: parseSugarExpression(part, p.span(base + m.argStart, base + m.end - 2), { writes: true })
                  .ast,
              })),
            span,
          },
        ],
        end: m.end,
        block: true,
      };
    case 'print':
    case '=':
      return {
        nodes: [
          {
            type: 'value',
            expression: expr(m.args, p.span(base + m.argStart, base + m.end - 2)),
            span,
          },
        ],
        end: m.end,
      };
    case 'if': {
      const b = readSugarcastBlock(source, m, registry);
      let no: StoryNode[] = [];
      for (let k = b.sections.length - 1; k >= 0; k--) {
        const section = b.sections[k];
        const branch = p.children(section.body, base + section.base, inline);
        if (registry.normalize(section.tag.name) === 'else') {
          no = branch;
        } else {
          const test = expr(section.tag.args, p.span(base + section.tag.argStart, base + section.tag.end - 2));
          no = [
            {
              type: 'if',
              test,
              yes: branch,
              no,
              span: p.span(base + section.tag.start, base + b.end),
            },
          ];
        }
      }
      return { nodes: no, end: b.end, block: true };
    }
    case 'elseif':
    case 'else':
      return p.error(
        'SUGARCAST_SECTION',
        `<<${m.name}>> must occur directly inside an <<if>> container.`,
        base + index,
        base + m.end,
      );
    case 'include': {
      const { value, rest } = firstString(m.args, p, base + m.argStart);
      return {
        nodes: [
          {
            type: 'include',
            target: value,
            props: rest.trim() ? expr(rest, p.span(base + m.end - 2 - rest.length, base + m.end - 2)) : undefined,
            span,
          },
        ],
        end: m.end,
        block: true,
      };
    }
    case 'for': {
      const match = /^(?:const\s+|let\s+)?(_?[A-Za-z]\w*)\s+of\s+([\s\S]+)$/.exec(m.args);
      if (!match)
        return p.error(
          'SUGARCAST_FOR',
          'Portable sugarcast uses <<for _item of expression>>. C-style and range loops require a rewrite.',
          base + index,
          base + m.end,
        );
      const b = readSugarcastBlock(source, m, registry);
      const items = expr(match[2], p.span(base + m.argStart + m.args.indexOf(match[2]), base + m.end - 2));
      const body = p.children(b.sections[0].body, base + b.sections[0].base, inline);
      return {
        nodes: [
          {
            type: 'each',
            name: match[1].replace(/^_/, ''),
            items,
            children: body,
            span: p.span(base + index, base + b.end),
          },
        ],
        end: b.end,
        block: true,
      };
    }
    case 'link':
    case 'button': {
      const { value: label, rest } = firstString(m.args, p, base + m.argStart);
      const target = rest.trim()
        ? firstString(rest.trim(), p, base + m.argStart + m.args.indexOf(rest)).value
        : undefined;
      const b = readSugarcastBlock(source, m, registry),
        body = b.sections[0];
      if (target && !body.body.trim())
        return {
          nodes: [
            {
              type: 'choice',
              target,
              children: [{ type: 'text', value: label, span }],
              span: p.span(base + index, base + b.end),
            },
          ],
          end: b.end,
        };
      const bodyEffects = actionBody(body.body, base + body.base, p, registry);
      if (target)
        bodyEffects.push({
          type: 'expression',
          expression: {
            type: 'CallExpression',
            callee: { type: 'Identifier', name: 'navigate' },
            arguments: [{ type: 'Literal', value: target }],
            optional: false,
          },
        });
      const name = p.addAction(bodyEffects, body.body, p.span(base + body.base, base + body.base + body.body.length));
      return {
        nodes: [
          {
            type: 'button',
            action: name,
            children: [{ type: 'text', value: label, span }],
            span: p.span(base + index, base + b.end),
          },
        ],
        end: b.end,
      };
    }
    case 'checkbox': {
      const variable = firstString(m.args, p, base + m.argStart);
      const values = variable.rest.trim().split(/\s+/);
      if (values.length < 2 || values.length > 3 || (values.length === 3 && values[2] !== 'autocheck'))
        return p.error(
          'SUGARCAST_CHECKBOX',
          'Portable checkbox expects <<checkbox "$variable" unchecked checked [autocheck]>>.',
          base + m.argStart,
          base + m.end - 2,
        );
      const target = expr(variable.value, p.span(base + m.argStart, base + m.end - 2));
      if (target.ast.type !== 'Identifier' && target.ast.type !== 'MemberExpression')
        return p.error(
          'SUGARCAST_CHECKBOX',
          'Checkbox binding must be an identifier or member expression.',
          base + m.argStart,
          base + m.end - 2,
        );
      const unchecked = expr(values[0], p.span(base + m.argStart, base + m.end - 2));
      const checked = expr(values[1], p.span(base + m.argStart, base + m.end - 2));
      const action = p.addAction(
        [
          {
            type: 'expression',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: target.ast,
              right: {
                type: 'ConditionalExpression',
                test: { type: 'Identifier', name: 'value' },
                consequent: checked.ast,
                alternate: unchecked.ast,
              },
            },
          },
        ],
        m.args,
        span,
      );
      return {
        nodes: [
          {
            type: 'control',
            control: 'checkbox',
            action,
            value: target,
            options: [],
            label: [],
            span,
          },
        ],
        end: m.end,
      };
    }
    case 'goto': {
      const target = expr(m.args, p.span(base + m.argStart, base + m.end - 2));
      return {
        nodes: [
          {
            type: 'effect',
            effects: [
              {
                type: 'expression',
                expression: {
                  type: 'CallExpression',
                  callee: { type: 'Identifier', name: 'navigate' },
                  arguments: [target.ast],
                  optional: false,
                },
              },
            ],
            span,
          },
        ],
        end: m.end,
        block: true,
      };
    }
  }
};

export function createSugarcastLowerings(): SugarcastLowerings {
  const registry = new MacroLoweringRegistry<SugarcastMacroCST, SugarcastMacroMeta>(caseInsensitiveMacroName);
  registry.register(['set', 'run', 'print', '=', 'include', 'checkbox', 'goto', 'elseif', 'else'], expandSugarcast);
  registry.register('if', expandSugarcast, {
    meta: { container: true, sections: ['elseif', 'else'] },
  });
  registry.register(['for', 'link', 'button'], expandSugarcast, {
    meta: { container: true },
  });
  return registry;
}

export function createSugarcastMacroReader(registry: SugarcastLowerings = createSugarcastLowerings()): SpecialReader {
  const documents = new Map<string, SugarcastDocumentCST>();
  const find = (nodes: SugarcastCSTNode[], start: number): SugarcastMacroCST | undefined => {
    for (const node of nodes) {
      if (node.type !== 'macro') continue;
      if (node.start === start) return node;
      const nested = find(node.children, start);
      if (nested) return nested;
    }
  };
  return (source, index, base, parser, inline) => {
    const token = readSugarcastMacro(source, index);
    if (!token) return;
    let document = documents.get(source);
    if (!document) {
      document = parseSugarcastCST(source);
      documents.set(source, document);
    }
    const node = find(document.children, token.start) ?? {
      ...token,
      type: 'macro' as const,
      fullEnd: token.end,
      children: [],
    };
    const result = registry.lower(token.name, {
      source,
      index,
      base,
      parser,
      inline,
      node,
    });
    if (result) return result;
    if (token.name.startsWith('/'))
      parser.error(
        'SUGARCAST_CLOSING',
        `Unexpected closing macro <<${token.name}>>.`,
        base + token.start,
        base + token.end,
      );
    const containers = sugarcastContainerNames(source);
    const container = containers.has(registry.normalize(token.name));
    const block = container ? readSugarcastBlock(source, token, registry, containers) : undefined;
    let args: ReturnType<typeof expr>[] = [];
    if (token.args.trim()) {
      try {
        args = [expr(token.args, parser.span(base + token.argStart, base + token.end - 2))];
      } catch {
        args = [
          {
            ast: { type: 'Literal', value: token.args },
            source: token.args,
            span: parser.span(base + token.argStart, base + token.end - 2),
          },
        ];
      }
    }
    return {
      nodes: [
        {
          type: 'invoke',
          id: `sugarcast/${registry.normalize(token.name)}`,
          phase: 'view',
          args,
          children: block
            ? parser.children(block.sections[0]?.body ?? '', base + (block.sections[0]?.base ?? token.end), inline)
            : [],
          span: parser.span(base + token.start, base + (block?.end ?? token.end)),
        },
      ],
      end: block?.end ?? token.end,
      block: !!block || !inline,
    };
  };
}

export const readSugarcast: SpecialReader = createSugarcastMacroReader();

export interface SugarcastParseOptions {
  lowerings?: SugarcastLowerings;
}

export function parseSugarcast(
  source: string,
  file = 'story.sugarcast',
  options: SugarcastParseOptions = {},
): ParseResult {
  const lowerings = options.lowerings ?? createSugarcastLowerings();
  const split = splitPassages(source, file),
    result: ParseResult = { passages: [], diagnostics: [...split.diagnostics] };
  for (const passage of split.passages)
    try {
      const parsed = basePassage(
        passage,
        'sugarcast',
        new MarkupParser({
          file,
          expression: expr,
          special: createSugarcastMacroReader(lowerings),
          isBlockStart: (line) => {
            const match = /^\s*<<\s*(\/?[A-Za-z][\w-]*|=)/.exec(line);
            return !!match;
          },
          extendParagraph: (source, start, end) => extendParagraph(source, start, end, lowerings),
        }),
      );
      parsed.evaluation = 'materialized';
      result.passages.push(parsed);
    } catch (e) {
      result.diagnostics.push(diag(e, passage.span));
    }
  return result;
}
