import { type CallableIR, type EffectNode, type StoryNode } from '@gneh/core';
import { MarkupParser, splitTopLevel } from '@gneh/syntax';
import { karloweAssignments } from './expression.js';
import { readKarloweMacro, type KarloweHookToken, type KarloweMacroToken } from './lexer.js';
import { harloweMacroName } from './names.js';

interface Attachment {
  hook?: KarloweHookToken;
  end: number;
}

export function customMacroAssignment(
  first: KarloweMacroToken,
  parser: MarkupParser,
  base: number,
  readAttachment: (source: string, first: KarloweMacroToken) => Attachment,
): EffectNode | undefined {
  const pieces = splitTopLevel(first.args, ' to ');
  if (pieces.length !== 2 || !pieces[1].trimStart().startsWith('(macro:')) return;
  const left = pieces[0].trim();
  const right = pieces[1].trim();
  const rightOffset = first.args.indexOf(pieces[1]) + pieces[1].indexOf(right);
  const literal = readKarloweMacro(right, 0);
  if (!literal || harloweMacroName(literal.name) !== 'macro' || literal.end !== right.length)
    return parser.error(
      'KARLOWE_MACRO_VALUE',
      'Expected one complete (macro:) value.',
      base + first.argsStart + rightOffset,
    );
  const parts = splitTopLevel(literal.args);
  const hook = parts.pop()?.trim() ?? '';
  if (!hook.startsWith('[') || !hook.endsWith(']'))
    return parser.error(
      'KARLOWE_MACRO_BODY',
      '(macro:) requires a final code hook.',
      base + first.argsStart + rightOffset,
    );
  const params = parts.map((part) => {
    const match = /^(?:[A-Za-z][\w-]*-type\s+)?(_[A-Za-z]\w*)$/i.exec(part.trim());
    if (!match)
      return parser.error(
        'KARLOWE_MACRO_PARAM',
        'Custom macro parameters must be typed temporary variables.',
        base + first.argsStart + rightOffset,
      );
    return { type: 'Identifier' as const, name: match[1] };
  });
  const body = hook.slice(1, -1);
  const bodyOffset = base + first.argsStart + rightOffset + literal.argsStart + literal.args.lastIndexOf(hook) + 1;
  const prefix: EffectNode[] = [];
  let cursor = 0;
  let callable: CallableIR | undefined;
  while (cursor < body.length) {
    while (/\s/.test(body[cursor] ?? '')) cursor++;
    if (cursor >= body.length) break;
    const macro = readKarloweMacro(body, cursor);
    if (!macro)
      return parser.error('KARLOWE_MACRO_BODY', 'Custom macro code hooks contain macro forms.', bodyOffset + cursor);
    const name = harloweMacroName(macro.name);
    if (name === 'set' || name === 'put') {
      prefix.push(
        ...karloweAssignments(
          macro.args,
          parser.span(bodyOffset + macro.argsStart, bodyOffset + macro.end - 1),
          name === 'put',
        ),
      );
      cursor = macro.end;
      continue;
    }
    const declarationSpan = parser.span(
      base + first.argsStart + rightOffset,
      base + first.argsStart + rightOffset + right.length,
    );
    if (name === 'outputdata') {
      callable = parser.callable(
        'value',
        undefined,
        params,
        { effects: prefix, result: parser.expr(macro.args, bodyOffset + macro.argsStart) },
        body,
        declarationSpan,
        'story',
      );
      cursor = macro.end;
      break;
    }
    if (name === 'output') {
      const attached = readAttachment(body, macro);
      const outputHook = attached.hook;
      if (!outputHook)
        return parser.error('KARLOWE_MACRO_OUTPUT', '(output:) must be attached to a hook.', bodyOffset + macro.start);
      const nodes: StoryNode[] = prefix.length
        ? [{ type: 'effect', effects: prefix, span: parser.span(bodyOffset, bodyOffset + macro.start) }]
        : [];
      nodes.push(
        ...parser.children(
          body.slice(outputHook.bodyStart, outputHook.bodyEnd),
          bodyOffset + outputHook.bodyStart,
          false,
        ),
      );
      callable = parser.callable('view', undefined, params, nodes, body, declarationSpan, 'story');
      cursor = attached.end;
      break;
    }
    return parser.error(
      'KARLOWE_MACRO_BODY',
      `Unsupported custom macro form (${macro.name}:).`,
      bodyOffset + macro.start,
    );
  }
  if (!callable)
    return parser.error('KARLOWE_MACRO_OUTPUT', 'A custom macro must use (output:) or (output-data:).', bodyOffset);
  if (body.slice(cursor).trim())
    return parser.error('KARLOWE_MACRO_OUTPUT', 'Custom macro output must be final.', bodyOffset + cursor);
  const target = parser.expr(left, base + first.argsStart + first.args.indexOf(left));
  if (target.ast.type !== 'Identifier' && target.ast.type !== 'MemberExpression')
    return parser.error(
      'KARLOWE_ASSIGN',
      'Custom macro assignment target must be a variable or property.',
      target.span.start,
    );
  return { type: 'assign-callable', target: target.ast, callable };
}
