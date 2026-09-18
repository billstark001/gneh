/** Portable IR pretty-printer used by the explicit migration command. */
import { GnehError, type Expr, type PassageIR, type Statement, type StoryNode } from '@gneh/core';

export function printExpression(e: Expr): string {
  const p = printExpression;
  switch (e.type) {
    case 'chain':
      return '(' + p(e.value) + ')';
    case 'literal':
      return JSON.stringify(e.value);
    case 'reference':
      if (e.namespace === 'state') return '$' + e.name;
      if (e.namespace === 'temporary') return '_' + e.name;
      return e.name;
    case 'array':
      return `[${e.items.map(p).join(', ')}]`;
    case 'object':
      return `{${e.entries.map(([k, v]) => `${JSON.stringify(k)}: ${p(v)}`).join(', ')}}`;
    case 'unary':
      return `(${e.op} ${p(e.value)})`;
    case 'binary':
      return `(${p(e.left)} ${e.op} ${p(e.right)})`;
    case 'conditional':
      return `(${p(e.test)} ? ${p(e.yes)} : ${p(e.no)})`;
    case 'get':
      return `${p(e.object)}${e.optional ? '?.' : ''}[${p(e.key)}]`;
    case 'call':
      return `${p(e.callee)}${e.optional ? '?.' : ''}(${e.args.map(p).join(', ')})`;
    case 'arrow':
      return `(${e.params.join(',')}) => ${p(e.body)}`;
    case 'template':
      return e.parts.map((x) => (typeof x === 'string' ? JSON.stringify(x) : `String(${p(x)})`)).join(' + ');
  }
}

export function printStatements(statements: Statement[], indent = '  '): string {
  return statements
    .map((s) => {
      switch (s.type) {
        case 'assign':
          return `${indent}${printExpression(s.target)} ${s.op} ${printExpression(s.value)};`;
        case 'declare':
          return `${indent}let ${s.name} = ${printExpression(s.value)};`;
        case 'call':
          return `${indent}${printExpression(s.expression)};`;
        case 'if':
          return `${indent}if (${printExpression(s.test)}) {\n${printStatements(s.yes, indent + '  ')}\n${indent}}${s.no.length ? ` else {\n${printStatements(s.no, indent + '  ')}\n${indent}}` : ''}`;
        case 'each':
          return `${indent}for (const ${s.name} of ${printExpression(s.items)}) {\n${printStatements(s.body, indent + '  ')}\n${indent}}`;
      }
    })
    .join('\n');
}

function escapeText(text: string): string {
  return text.replace(/[\\$*_[\]`]/g, '\\$&');
}

export function toInkdown(passages: PassageIR[]): string {
  const render = (nodes: StoryNode[]): string =>
    nodes
      .map((n) => {
        switch (n.type) {
          case 'text':
            return escapeText(n.value);
          case 'value':
            return `{{ ${printExpression(n.expression.ast)} }}`;
          case 'if':
            return `\n@if (${printExpression(n.test.ast)}) {\n${render(n.yes)}\n}${n.no.length ? ` @else {\n${render(n.no)}\n}` : ''}\n`;
          case 'each':
            return `\n@for (const ${n.name} of ${printExpression(n.items.ast)}${n.key ? `; key ${printExpression(n.key.ast)}` : ''}) {\n${render(n.children)}\n}\n`;
          case 'include':
            return `@${n.target}(${n.props ? printExpression(n.props.ast) : ''})`;
          case 'choice':
            return `[[${render(n.children)} -> ${n.target}${n.props ? '(' + printExpression(n.props.ast) + ')' : ''}]]`;
          case 'button':
            return `[[${render(n.children)} => ${n.action}]]`;
          case 'region':
            return `\n@region ${n.name} {\n${render(n.children)}\n}\n`;
          case 'extension':
            return `\n::: ${n.name} {${Object.entries(n.attrs)
              .map(([k, v]) =>
                k === 'tokens' && Array.isArray(v) ? v.map((t) => '.' + t).join(' ') : `${k}=${JSON.stringify(v)}`,
              )
              .join(' ')} ${Object.entries(n.bindings)
              .map(([k, e]) => `${k}={{ ${printExpression(e.ast)} }}`)
              .join(' ')}}\n${render(n.children)}\n:::\n`;
          case 'effect':
          case 'interaction':
          case 'region-change':
          case 'portal':
          case 'control':
          case 'invoke':
            throw new GnehError(
              'MIGRATION_UNREPRESENTABLE',
              `${n.type} has no behavior-preserving Inkdown spelling. Keep the source dialect or rewrite it explicitly.`,
              n.span,
            );
          case 'content': {
            const c = render(n.children);
            switch (n.kind) {
              case 'paragraph':
                return c + '\n\n';
              case 'heading':
                return '#'.repeat(Number(n.attrs.level) || 1) + ' ' + c + '\n\n';
              case 'strong':
                return '**' + c + '**';
              case 'emphasis':
                return '*' + c + '*';
              case 'strike':
                return '~~' + c + '~~';
              case 'code':
                return '`' + n.children.map((x) => (x.type === 'text' ? x.value : '')).join('') + '`';
              case 'code-block':
                return (
                  '```' +
                  (n.attrs.language ?? '') +
                  '\n' +
                  n.children.map((x) => (x.type === 'text' ? x.value : '')).join('') +
                  '\n```\n\n'
                );
              case 'quote':
                return '> ' + c + '\n';
              case 'list':
                return (
                  n.children.map((x, i) => (n.attrs.ordered ? `${i + 1}. ` : '- ') + render([x]) + '\n').join('') + '\n'
                );
              case 'item':
                return c;
              case 'link':
                return `[${c}](${n.attrs.href})`;
              case 'image':
                return `![${n.attrs.alt ?? ''}](${n.attrs.src})`;
              case 'rule':
                return '\n---\n';
              case 'break':
                return '\n';
              case 'span':
                return `[${c}]{${Array.isArray(n.attrs.tokens) ? n.attrs.tokens.map((t) => '.' + t).join(' ') : ''}}`;
            }
          }
        }
      })
      .join('');
  return passages
    .map((p) => {
      const metadata = { ...p.metadata };
      delete metadata.name;
      delete metadata.dialect;
      return `:: ${p.name} ${JSON.stringify(metadata)}\n${p.module ? '@module {\n' + p.module + '\n}\n' : ''}${p.enter.length ? '@enter {\n' + printStatements(p.enter) + '\n}\n' : ''}${Object.values(
        p.actions,
      )
        .map((a) => '@action ' + a.name + ' {\n' + printStatements(a.statements) + '\n}\n')
        .join('')}\n${render(p.body).trim()}\n`;
    })
    .join('\n');
}
