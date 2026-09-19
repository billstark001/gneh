/** Portable IR pretty-printer used by the explicit migration command. */
import { GnehError, type EffectNode, type PassageIR, type StoryNode } from '@gneh/core';
import type { BindingPattern, ExpressionNode, Property } from '@gneh/expression';

export type IdentifierPrinter = (name: string) => string;

export function printBinding(binding: BindingPattern, identifier: IdentifierPrinter): string {
  switch (binding.type) {
    case 'Identifier':
      return identifier(binding.name);
    case 'AssignmentPattern':
      return `${printBinding(binding.left, identifier)} = ${printExpression(binding.right, identifier)}`;
    case 'RestElement':
      return `...${printBinding(binding.argument, identifier)}`;
    case 'ArrayPattern':
      return `[${binding.elements.map((element) => (element ? printBinding(element, identifier) : '')).join(', ')}]`;
    case 'ObjectPattern':
      return `{${binding.properties
        .map((property) => {
          if (property.type === 'RestElement') return `...${printBinding(property.argument, identifier)}`;
          const key = printPropertyKey(property, identifier);
          return `${key}: ${printBinding(property.value, identifier)}`;
        })
        .join(', ')}}`;
  }
}

function printPropertyKey(property: Pick<Property, 'computed' | 'key'>, identifier: IdentifierPrinter): string {
  if (property.computed) return `[${printExpression(property.key, identifier)}]`;
  if (property.key.type === 'Identifier') return property.key.name;
  return printExpression(property.key, (name) => name);
}

function printTemplateText(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
}

export function printExpression(e: ExpressionNode, identifier: IdentifierPrinter = (name) => name): string {
  const p = (node: ExpressionNode) => printExpression(node, identifier);
  switch (e.type) {
    case 'Literal':
      return typeof e.raw === 'string' ? e.raw : JSON.stringify(e.value);
    case 'Identifier':
      return identifier(e.name);
    case 'TopicReference':
      return '#';
    case 'UnaryExpression':
      return `(${e.operator}${/^[a-z]/i.test(e.operator) ? ' ' : ''}${p(e.argument)})`;
    case 'UpdateExpression':
      return e.prefix ? `(${e.operator}${p(e.argument)})` : `(${p(e.argument)}${e.operator})`;
    case 'AwaitExpression':
      return `(await ${p(e.argument)})`;
    case 'BinaryExpression':
    case 'LogicalExpression':
      return `(${p(e.left)} ${e.operator} ${p(e.right)})`;
    case 'AssignmentExpression':
      return `(${p(e.left)} ${e.operator} ${p(e.right)})`;
    case 'ConditionalExpression':
      return `(${p(e.test)} ? ${p(e.consequent)} : ${p(e.alternate)})`;
    case 'MemberExpression':
      return e.computed
        ? `${p(e.object)}${e.optional ? '?.' : ''}[${p(e.property)}]`
        : `${p(e.object)}${e.optional ? '?.' : '.'}${e.property.type === 'Identifier' ? e.property.name : p(e.property)}`;
    case 'CallExpression':
      return `${p(e.callee)}${e.optional ? '?.' : ''}(${e.arguments.map(p).join(', ')})`;
    case 'ChainExpression':
      return p(e.expression);
    case 'ArrayExpression':
      return `[${e.elements.map((element) => (element ? p(element) : '')).join(', ')}]`;
    case 'ObjectExpression':
      return `{${e.properties
        .map((property) =>
          property.type === 'SpreadElement'
            ? `...${p(property.argument)}`
            : `${printPropertyKey(property, identifier)}: ${p(property.value)}`,
        )
        .join(', ')}}`;
    case 'SpreadElement':
      return `...${p(e.argument)}`;
    case 'TemplateLiteral':
      return `\`${e.quasis
        .map(
          (quasi, index) =>
            `${printTemplateText(quasi.value.raw)}${index < e.expressions.length ? `\${${p(e.expressions[index])}}` : ''}`,
        )
        .join('')}\``;
    case 'TaggedTemplateExpression':
      return `${p(e.tag)}${p(e.quasi)}`;
    case 'SequenceExpression':
      return `(${e.expressions.map(p).join(', ')})`;
    case 'ArrowFunctionExpression':
      return `(${e.params.map((param) => printBinding(param, identifier)).join(', ')}) => ${p(e.body)}`;
    case 'PipelineExpression':
      return `(${p(e.left)} |> ${p(e.right)})`;
  }
}

export function printEffects(effects: EffectNode[], indent = '  '): string {
  return effects
    .map((s) => {
      switch (s.type) {
        case 'bind':
          return `${indent}@let ${printBinding(s.binding, (name) => name)} = ${printExpression(s.value)};`;
        case 'expression':
          return `${indent}@do ${printExpression(s.expression)};`;
        case 'if':
          return `${indent}@if (${printExpression(s.test)}) {\n${printEffects(s.yes, indent + '  ')}\n${indent}}${s.no.length ? ` @else {\n${printEffects(s.no, indent + '  ')}\n${indent}}` : ''}`;
        case 'each':
          return `${indent}@each (${printBinding(s.binding, (name) => name)} of ${printExpression(s.items)}) {\n${printEffects(s.body, indent + '  ')}\n${indent}}`;
        case 'invoke':
          return `${indent}@call ${s.name}(${s.args.map((argument) => printExpression(argument)).join(', ')});`;
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
            return `\n@each (${n.name} of ${printExpression(n.items.ast)}${n.key ? `; key ${printExpression(n.key.ast)}` : ''}) {\n${render(n.children)}\n}\n`;
          case 'include':
            return `@${n.target}(${n.props ? printExpression(n.props.ast) : ''})`;
          case 'choice':
            return `[[${render(n.children)} -> ${n.target}${n.props ? '(' + printExpression(n.props.ast) + ')' : ''}]]`;
          case 'button':
            return `[[${render(n.children)} => ${n.action.name}(${n.action.args.map((argument) => printExpression(argument)).join(', ')})]]`;
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
            return `\n@effect {\n${printEffects(n.effects)}\n}\n`;
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
          case 'view-call':
            return `@${n.name}(${n.args.map((argument) => printExpression(argument.ast)).join(', ')})${n.children.length ? `{${render(n.children)}}` : ''}`;
          case 'children':
            return '@children';
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
      return `:: ${p.name} ${JSON.stringify(metadata)}\n${p.imports.map((value) => `@import { ${value.imported}${value.imported === value.local ? '' : ` as ${value.local}`} } from ${JSON.stringify(value.source)}\n`).join('')}${p.exports.length ? `@export { ${p.exports.join(', ')} }\n` : ''}${Object.entries(
        p.constants,
      )
        .map(([name, value]) => `@const ${name} = ${printExpression(value.ast)}\n`)
        .join('')}${p.enter.length ? '@enter {\n' + printEffects(p.enter) + '\n}\n' : ''}${Object.values(p.effects)
        .filter((effect) => !effect.name.startsWith('__action'))
        .map(
          (effect) =>
            `@action ${effect.name}(${effect.params.map((param) => printBinding(param, (name) => name)).join(', ')}) {\n${printEffects(effect.body)}\n}\n`,
        )
        .join('')}${Object.values(p.views)
        .map(
          (view) =>
            `@view ${view.name}(${view.params.map((param) => printBinding(param, (name) => name)).join(', ')}) {\n${render(view.body).trim()}\n}\n`,
        )
        .join('')}\n${render(p.body).trim()}\n`;
    })
    .join('\n');
}
