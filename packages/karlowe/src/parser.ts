import { type EffectNode, type Expression, type ParseResult, type StoryNode } from '@gneh/core';
import { splitPassages, diag } from '@gneh/source';
import {
  harloweMacroName,
  MacroLoweringRegistry,
  MarkupParser,
  basePassage,
  splitTopLevel,
  type MacroLowering,
  type SpecialReader,
} from '@gneh/syntax';
import { parseKarloweExpression, karloweAssignments } from './expression.js';
import {
  parseKarloweCST,
  readKarloweHook,
  readKarloweMacro,
  readKarloweToken,
  type KarloweCSTNode,
  type KarloweDocumentCST,
  type KarloweHookToken,
  type KarloweMacroToken,
} from './lexer.js';

export interface KarloweAttachment {
  macros: KarloweMacroToken[];
  hook?: KarloweHookToken;
  end: number;
}

export interface KarloweMacroMeta {
  presentation?: string;
}

export type KarloweLowerings = MacroLoweringRegistry<KarloweMacroToken, KarloweMacroMeta>;

const spaces = (source: string, start: number) => {
  let i = start;
  while (/\s/.test(source[i] ?? '')) i++;
  return i;
};

export function readKarloweAttachment(source: string, first: KarloweMacroToken): KarloweAttachment {
  const macros = [first];
  let cursor = spaces(source, first.end);
  while (source[cursor] === '+') {
    const next = readKarloweMacro(source, spaces(source, cursor + 1));
    if (!next) break;
    macros.push(next);
    cursor = spaces(source, next.end);
  }
  let hook = readKarloweHook(source, cursor);
  // Harlowe permits a changer to attach directly to link markup. Model that
  // as an anonymous hook whose body is the complete link, without making `[[`
  // ambiguous everywhere else in the lexer.
  if (!hook && source.startsWith('[[', cursor) && source[cursor + 2] !== '[') {
    const link = readKarloweToken(source, cursor);
    if (link?.type === 'link')
      hook = {
        type: 'hook',
        hidden: false,
        start: cursor,
        bodyStart: cursor,
        bodyEnd: link.end,
        end: link.end,
      };
  }
  return { macros, hook, end: hook?.end ?? first.end };
}

function requireHook(value: KarloweAttachment, p: MarkupParser, base: number): KarloweHookToken {
  if (!value.hook)
    p.error(
      'KARLOWE_BODY',
      'This changer requires an attached [hook].',
      base + value.macros[0].start,
      base + value.end,
    );
  return value.hook;
}

function literalString(source: string, p: MarkupParser, start: number): string {
  const ast = p.expr(source, start).ast;
  if (ast.type !== 'Literal' || typeof ast.value !== 'string')
    p.error('STATIC_TARGET', 'Expected a literal string.', start, start + source.length);
  return ast.value as string;
}

function expression(macro: KarloweMacroToken, p: MarkupParser, base: number): Expression {
  return p.expr(macro.args, base + macro.argsStart);
}

function presentationExpression(property: string, macro: KarloweMacroToken, p: MarkupParser, base: number): Expression {
  const raw = macro.args.trim();
  if (
    property === 'foreground' &&
    /^(?:#[\da-f]{3,8}|[a-z][\w-]*)(?:\s*\+\s*(?:#[\da-f]{3,8}|[a-z][\w-]*))*$/i.test(raw)
  )
    return {
      ast: { type: 'Literal', value: raw },
      source: raw,
      span: p.span(base + macro.argsStart, base + macro.end - 1),
    };
  const args = splitTopLevel(macro.args);
  if (args.length > 1)
    return {
      ast: {
        type: 'ArrayExpression',
        elements: args.map((arg) => p.expr(arg, base + macro.argsStart + macro.args.indexOf(arg)).ast),
      },
      source: macro.args,
      span: p.span(base + macro.argsStart, base + macro.end - 1),
    };
  return expression(macro, p, base);
}

function wrapPresentation(
  nodes: StoryNode[],
  macros: KarloweMacroToken[],
  registry: KarloweLowerings,
  p: MarkupParser,
  base: number,
  end: number,
): StoryNode[] {
  let result = nodes;
  for (let index = macros.length - 1; index >= 0; index--) {
    const macro = macros[index];
    const property = registry.resolve(macro.name)?.meta?.presentation;
    if (!property) continue;
    result = [
      {
        type: 'extension',
        name: 'presentation',
        attrs: { property },
        bindings: { value: presentationExpression(property, macro, p, base) },
        children: result,
        span: p.span(base + macro.start, base + end),
      },
    ];
  }
  return result;
}

function labelNodes(macro: KarloweMacroToken, p: MarkupParser, base: number): StoryNode[] {
  const value = expression(macro, p, base);
  if (value.ast.type === 'Literal' && typeof value.ast.value === 'string')
    return [
      {
        type: 'text',
        value: value.ast.value,
        span: p.span(base + macro.argsStart, base + macro.end - 1),
      },
    ];
  return [
    {
      type: 'value',
      expression: value,
      span: p.span(base + macro.start, base + macro.end),
    },
  ];
}

function hostEffect(operation: string, args: Expression[]): EffectNode {
  return {
    type: 'expression',
    expression: {
      type: 'CallExpression',
      callee: { type: 'Identifier', name: 'host' },
      arguments: [{ type: 'Literal', value: operation }, ...args.map((item) => item.ast)],
      optional: false,
    },
  };
}

function effect(effects: EffectNode[], macro: KarloweMacroToken, p: MarkupParser, base: number) {
  return {
    type: 'effect' as const,
    effects,
    span: p.span(base + macro.start, base + macro.end),
  };
}

function hookName(raw: string): string | undefined {
  const match = /^\?\s*([A-Za-z][\w-]*)\s*$/i.exec(raw);
  return match?.[1].replaceAll('-', '').toLowerCase();
}

function parseControl(
  macro: KarloweMacroToken,
  kind: 'checkbox' | 'dropdown',
  p: MarkupParser,
  base: number,
): StoryNode {
  const args = splitTopLevel(macro.args);
  const binding = /^(?:2bind|bind)\s+([$_A-Za-z][\w$]*(?:'s\s+[\w-]+|\.[A-Za-z_]\w*)*)$/i.exec(args[0] ?? '');
  if (!binding)
    p.error(
      'KARLOWE_BINDING',
      `(${macro.name}:) requires bind or 2bind followed by a variable.`,
      base + macro.argsStart,
      base + macro.end - 1,
    );
  const target = p.expr(binding[1], base + macro.argsStart + macro.args.indexOf(binding[1]));
  if (target.ast.type !== 'Identifier' && target.ast.type !== 'MemberExpression')
    p.error(
      'KARLOWE_BINDING',
      `(${macro.name}:) binding must be an identifier or member expression.`,
      base + macro.argsStart,
      base + macro.end - 1,
    );
  const values = args.slice(1).map((arg) => p.expr(arg, base + macro.argsStart + macro.args.indexOf(arg)));
  const action = p.addAction(
    [
      {
        type: 'expression',
        expression: {
          type: 'AssignmentExpression',
          operator: '=',
          left: target.ast,
          right: { type: 'Identifier', name: 'value' },
        },
      },
    ],
    macro.args,
    p.span(base + macro.argsStart, base + macro.end - 1),
  );
  return {
    type: 'control',
    control: kind === 'checkbox' ? 'checkbox' : 'select',
    action,
    value: target,
    options: kind === 'checkbox' ? [] : values,
    label: kind === 'checkbox' && values[0] ? [{ type: 'value', expression: values[0], span: values[0].span }] : [],
    span: p.span(base + macro.start, base + macro.end),
  };
}

const expandKarlowe: MacroLowering<KarloweMacroToken, KarloweMacroMeta> = ({
  source,
  index,
  base,
  parser: p,
  inline,
  node: first,
  name,
  lowerings: registry,
}) => {
  const value = readKarloweAttachment(source, first);
  const span = p.span(base + first.start, base + value.end);

  if (name === 'set' || name === 'put')
    return {
      nodes: [
        effect(
          karloweAssignments(first.args, p.span(base + first.argsStart, base + first.end - 1), name === 'put'),
          first,
          p,
          base,
        ),
      ],
      end: first.end,
      block: !inline,
    };

  if (name === 'print')
    return {
      nodes: [{ type: 'value', expression: expression(first, p, base), span }],
      end: first.end,
    };

  if (registry.resolve(name)?.meta?.presentation) {
    const hook = requireHook(value, p, base);
    const unknown = value.macros.find((macro) => !registry.resolve(macro.name)?.meta?.presentation);
    if (unknown)
      p.error(
        'KARLOWE_CHANGER',
        `(${unknown.name}:) cannot be composed with this presentation changer.`,
        base + unknown.start,
        base + unknown.end,
      );
    const children = p.children(source.slice(hook.bodyStart, hook.bodyEnd), base + hook.bodyStart, inline);
    return {
      nodes: wrapPresentation(children, value.macros, registry, p, base, hook.end),
      end: hook.end,
      block: !inline,
    };
  }

  if (name === 'if' || name === 'unless') {
    const hook = requireHook(value, p, base);
    let yes = p.children(source.slice(hook.bodyStart, hook.bodyEnd), base + hook.bodyStart, inline);
    yes = wrapPresentation(yes, value.macros.slice(1), registry, p, base, hook.end);
    let end = hook.end;
    let no: StoryNode[] = [];
    const alternatives: {
      macro: KarloweMacroToken;
      hook: KarloweHookToken;
      body: StoryNode[];
    }[] = [];
    let cursor = spaces(source, end);
    while (true) {
      const alternate = readKarloweMacro(source, cursor);
      if (!alternate || !['else', 'elseif'].includes(registry.normalize(alternate.name))) break;
      const alternateValue = readKarloweAttachment(source, alternate);
      const alternateHook = requireHook(alternateValue, p, base);
      const body = p.children(
        source.slice(alternateHook.bodyStart, alternateHook.bodyEnd),
        base + alternateHook.bodyStart,
        inline,
      );
      end = alternateHook.end;
      if (registry.normalize(alternate.name) === 'else') {
        no = body;
        break;
      }
      alternatives.push({ macro: alternate, hook: alternateHook, body });
      cursor = spaces(source, end);
    }
    for (let alternate = alternatives.length - 1; alternate >= 0; alternate--) {
      const item = alternatives[alternate];
      no = [
        {
          type: 'if',
          test: expression(item.macro, p, base),
          yes: item.body,
          no,
          span: p.span(base + item.macro.start, base + item.hook.end),
        },
      ];
    }
    let test = expression(first, p, base);
    if (name === 'unless')
      test = { ...test, ast: { type: 'UnaryExpression', operator: '!', prefix: true, argument: test.ast } };
    return {
      nodes: [{ type: 'if', test, yes, no, span: p.span(span.start, base + end) }],
      end,
      block: !inline,
    };
  }

  if (name === 'else' || name === 'elseif')
    p.error('KARLOWE_ELSE', 'An else macro must immediately follow its if hook.', base + index, base + first.end);

  if (name === 'display')
    return {
      nodes: [
        {
          type: 'include',
          target: literalString(first.args, p, base + first.argsStart),
          span,
        },
      ],
      end: first.end,
      block: !inline,
    };

  if (name === 'linkgoto') {
    const args = splitTopLevel(first.args);
    if (args.length !== 2) p.error('KARLOWE_ARGS', '(link-goto:) expects a label and target.', base + index);
    const label = literalString(args[0], p, base + first.argsStart);
    const target = literalString(args[1], p, base + first.argsStart + first.args.indexOf(args[1]));
    return {
      nodes: [
        {
          type: 'choice',
          target,
          children: [{ type: 'text', value: label, span }],
          span,
        },
      ],
      end: first.end,
    };
  }

  if (name === 'link' || name === 'linkrepeat') {
    const hook = requireHook(value, p, base);
    return {
      nodes: [
        {
          type: 'interaction',
          behavior: name === 'linkrepeat' ? 'repeat' : 'reveal',
          label: labelNodes(first, p, base),
          children: p.children(source.slice(hook.bodyStart, hook.bodyEnd), base + hook.bodyStart, inline),
          span: p.span(base + first.start, base + hook.end),
        },
      ],
      end: hook.end,
      block: !inline,
    };
  }

  if (name === 'for') {
    const args = splitTopLevel(first.args);
    const variable = /^each\s+(_?[A-Za-z]\w*)$/i.exec(args[0] ?? '');
    if (!variable || args.length < 2)
      return p.error('KARLOWE_FOR', 'Use (for: each _item, (a: ...))[body].', base + index);
    const hook = requireHook(value, p, base);
    const itemSource = args.slice(1).join(',');
    const items =
      args.length === 2
        ? p.expr(args[1], base + first.argsStart + first.args.indexOf(args[1]))
        : {
            ast: {
              type: 'ArrayExpression' as const,
              elements: args.slice(1).map((arg) => p.expr(arg, base + first.argsStart + first.args.indexOf(arg)).ast),
            },
            source: itemSource,
            span: p.span(base + first.argsStart, base + first.end - 1),
          };
    return {
      nodes: [
        {
          type: 'each',
          name: variable[1].replace(/^_/, ''),
          items,
          children: p.children(source.slice(hook.bodyStart, hook.bodyEnd), base + hook.bodyStart, inline),
          span: p.span(base + first.start, base + hook.end),
        },
      ],
      end: hook.end,
      block: !inline,
    };
  }

  if (name === 'append' || name === 'prepend' || name === 'replace') {
    const hook = requireHook(value, p, base);
    const target = hookName(first.args);
    if (!target)
      return p.error(
        'KARLOWE_HOOK_TARGET',
        `(${name}:) supports semantic hook references such as ?notice, not text/DOM queries.`,
        base + first.argsStart,
        base + first.end - 1,
      );
    const children = p.children(source.slice(hook.bodyStart, hook.bodyEnd), base + hook.bodyStart, inline);
    return {
      nodes: [
        target === 'sidebar'
          ? { type: 'portal', name: 'sidebar', mode: name, children, span }
          : { type: 'region-change', name: target, mode: name, children, span },
      ],
      end: hook.end,
      block: !inline,
    };
  }

  if (name === 'dropdown' || name === 'checkbox')
    return { nodes: [parseControl(first, name, p, base)], end: first.end };

  if (name === 'goto') {
    const target = expression(first, p, base);
    return {
      nodes: [
        effect(
          [
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
          first,
          p,
          base,
        ),
      ],
      end: first.end,
      block: !inline,
    };
  }

  if (name === 'gotourl' || name === 'reload') {
    const args = name === 'reload' ? [] : [expression(first, p, base)];
    return {
      nodes: [effect([hostEffect(name === 'reload' ? 'restart' : 'open-external', args)], first, p, base)],
      end: first.end,
      block: !inline,
    };
  }

  if (name === 'savegame' || name === 'loadgame') {
    const args = first.args.trim()
      ? splitTopLevel(first.args).map((arg) => p.expr(arg, base + first.argsStart + first.args.indexOf(arg)))
      : [];
    const operation = name.startsWith('save') ? 'save' : 'load';
    return {
      nodes: [effect([hostEffect(operation, args)], first, p, base)],
      end: first.end,
      block: !inline,
    };
  }

  if (name === 'linkundo') {
    const args = splitTopLevel(first.args);
    const label = literalString(args[0] ?? '"Undo"', p, base + first.argsStart);
    const action = p.addAction(
      [hostEffect('undo', [])],
      first.args,
      p.span(base + first.argsStart, base + first.end - 1),
    );
    return {
      nodes: [
        {
          type: 'button',
          action,
          children: [{ type: 'text', value: label, span }],
          span,
        },
      ],
      end: first.end,
    };
  }
};

export function createKarloweLowerings(): KarloweLowerings {
  const registry = new MacroLoweringRegistry<KarloweMacroToken, KarloweMacroMeta>(harloweMacroName);
  registry.register(
    [
      'set',
      'put',
      'print',
      'if',
      'unless',
      'else',
      'else-if',
      'display',
      'link-goto',
      'link',
      'link-repeat',
      'for',
      'append',
      'prepend',
      'replace',
      'dropdown',
      'checkbox',
      'go-to',
      'goto-url',
      'reload',
      'save-game',
      'load-game',
      'link-undo',
    ],
    expandKarlowe,
  );
  const presentation = (names: readonly string[], property: string) =>
    registry.register(names, expandKarlowe, { meta: { presentation: property } });
  presentation(['color', 'colour', 'text-color', 'text-colour'], 'foreground');
  presentation(['font'], 'font-family');
  presentation(['text-style'], 'text-style');
  presentation(['size', 'text-size'], 'scale');
  presentation(['border', 'b4r'], 'border-style');
  presentation(['border-color', 'border-colour', 'b4r-color', 'b4r-colour'], 'border-color');
  presentation(['corner-radius'], 'corner-radius');
  return registry;
}

export function createKarloweMacroReader(registry: KarloweLowerings = createKarloweLowerings()): SpecialReader {
  const documents = new Map<string, KarloweDocumentCST>();
  const findMacro = (nodes: KarloweCSTNode[], start: number): KarloweMacroToken | undefined => {
    for (const node of nodes) {
      if (node.type === 'macro' && node.start === start) return node;
      if (node.type === 'hook') {
        const nested = findMacro(node.children, start);
        if (nested) return nested;
      }
    }
  };
  return (source, index, base, parser, inline) => {
    const directHook = readKarloweHook(source, index);
    if (directHook) {
      const children = directHook.hidden
        ? []
        : parser.children(source.slice(directHook.bodyStart, directHook.bodyEnd), base + directHook.bodyStart, inline);
      return {
        nodes: directHook.name
          ? [
              {
                type: 'region',
                name: directHook.name,
                children,
                span: parser.span(base + directHook.start, base + directHook.end),
              },
            ]
          : children,
        end: directHook.end,
        block: !inline,
      };
    }

    const scanned = readKarloweMacro(source, index);
    if (!scanned) {
      if (/^\?[A-Za-z_][\w-]*/.test(source.slice(index)))
        parser.error('KARLOWE_HOOK', 'A hook reference is only valid as a supported macro argument.', base + index);
      return;
    }
    let document = documents.get(source);
    if (!document) {
      document = parseKarloweCST(source);
      documents.set(source, document);
    }
    const token = findMacro(document.children, scanned.start) ?? scanned;
    const result = registry.lower(token.name, {
      source,
      index,
      base,
      parser,
      inline,
      node: token,
    });
    if (result) return result;
    const attachment = readKarloweAttachment(source, token);
    let children = attachment.hook
      ? parser.children(
          source.slice(attachment.hook.bodyStart, attachment.hook.bodyEnd),
          base + attachment.hook.bodyStart,
          inline,
        )
      : [];
    for (let macroIndex = attachment.macros.length - 1; macroIndex >= 0; macroIndex--) {
      const macro = attachment.macros[macroIndex];
      let args: Expression[] = [];
      if (macro.args.trim()) {
        try {
          args = splitTopLevel(macro.args).map((argument) =>
            parser.expr(argument, base + macro.argsStart + macro.args.indexOf(argument)),
          );
        } catch {
          args = [
            {
              ast: { type: 'Literal', value: macro.args },
              source: macro.args,
              span: parser.span(base + macro.argsStart, base + macro.end - 1),
            },
          ];
        }
      }
      children = [
        {
          type: 'invoke',
          id: `karlowe/${registry.normalize(macro.name)}`,
          phase: 'view',
          args,
          children,
          span: parser.span(base + macro.start, base + attachment.end),
        },
      ];
    }
    return { nodes: children, end: attachment.end, block: !!attachment.hook && !inline };
  };
}

export const readKarlowe: SpecialReader = createKarloweMacroReader();

function extendParagraph(source: string, start: number, initialEnd: number): number {
  let end = initialEnd;
  let cursor = start;
  while (cursor <= end) {
    const macroIndex = source.indexOf('(', cursor);
    const hookIndex = source.indexOf('[', cursor);
    const index = [macroIndex, hookIndex]
      .filter((value) => value >= 0 && value <= end)
      .sort((left, right) => left - right)[0];
    if (index === undefined) break;
    const macro = readKarloweMacro(source, index);
    if (macro) {
      const value = readKarloweAttachment(source, macro);
      end = Math.max(end, value.end);
      cursor = value.end;
      const name = harloweMacroName(macro.name);
      if (name === 'if' || name === 'unless') {
        let alternateCursor = spaces(source, cursor);
        while (true) {
          const alternate = readKarloweMacro(source, alternateCursor);
          if (!alternate || !['else', 'elseif'].includes(harloweMacroName(alternate.name))) break;
          const alternateValue = readKarloweAttachment(source, alternate);
          end = Math.max(end, alternateValue.end);
          cursor = alternateValue.end;
          alternateCursor = spaces(source, cursor);
        }
      }
      continue;
    }
    const hook = readKarloweHook(source, index);
    if (hook) {
      end = Math.max(end, hook.end);
      cursor = hook.end;
    } else cursor = index + 1;
  }
  return end;
}

export interface KarloweParseOptions {
  lowerings?: KarloweLowerings;
}

export function parseKarlowe(source: string, file = 'story.karlowe', options: KarloweParseOptions = {}): ParseResult {
  const lowerings = options.lowerings ?? createKarloweLowerings();
  const split = splitPassages(source, file);
  const result: ParseResult = { passages: [], diagnostics: [...split.diagnostics] };
  for (const passage of split.passages)
    try {
      const parsed = basePassage(
        passage,
        'karlowe',
        new MarkupParser({
          file,
          expression: parseKarloweExpression,
          special: createKarloweMacroReader(lowerings),
          inlineMarks: [
            ["''", 'strong'],
            ['//', 'emphasis'],
          ],
          isBlockStart: (line) => {
            const match = /^\s*\(([\w-]+)\s*:/.exec(line);
            return !!match;
          },
          extendParagraph,
        }),
      );
      parsed.evaluation = 'materialized';
      result.passages.push(parsed);
    } catch (error) {
      result.diagnostics.push(diag(error, passage.span));
    }
  return result;
}
