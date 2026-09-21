import { bindingNames, type EffectNode } from '@gneh/core';
import { parseIterationClause, scanBindingPattern, scanExpression } from '@gneh/expression';
import { balanced, type MarkupParser } from '@gneh/syntax';

const spaces = (source: string, start: number) => {
  while (/\s/.test(source[start] ?? '')) start++;
  return start;
};

/** Parse Inkdown's deliberately small, non-JavaScript effect language. */
export function parseEffects(source: string, base: number, parser: MarkupParser): EffectNode[] {
  const effects: EffectNode[] = [];
  let index = 0;
  while ((index = spaces(source, index)) < source.length) {
    const head = /^@([A-Za-z_][\w-]*)\b/.exec(source.slice(index));
    if (!head) parser.error('EFFECT_DIRECTIVE', 'Effect bodies contain only Inkdown @ directives.', base + index);
    const name = head[1];
    let cursor = spaces(source, index + head[0].length);
    if (name === 'do') {
      const expression = scanExpression(source, cursor, parser.span(base + cursor, base + source.length), {
        writes: true,
      });
      const terminator = spaces(source, expression.next);
      if (source[terminator] !== ';')
        parser.error('EFFECT_TERMINATOR', 'Effect directives must end with a semicolon.', base + terminator);
      effects.push({ type: 'expression', expression: expression.expression });
      index = terminator + 1;
      continue;
    }
    if (name === 'let' || name === 'const') {
      const binding = scanBindingPattern(
        source,
        parser.span(base + cursor, base + source.length),
        (token, depth) => depth === 0 && token.kind === 'op' && token.value === '=',
        cursor,
        { allowState: true },
      );
      const equals = spaces(source, binding.next);
      if (source[equals] !== '=')
        parser.error('EFFECT_BINDING', '@let requires a binding pattern and value.', base + equals);
      const value = scanExpression(source, equals + 1, parser.span(base + equals + 1, base + source.length));
      const terminator = spaces(source, value.next);
      if (source[terminator] !== ';')
        parser.error('EFFECT_TERMINATOR', 'Effect directives must end with a semicolon.', base + terminator);
      const stateNames = bindingNames(binding.pattern).filter((bindingName) => bindingName.startsWith('$'));
      if (stateNames.length && (name === 'const' || binding.pattern.type !== 'Identifier'))
        parser.error(
          'EFFECT_BINDING',
          name === 'const'
            ? '@const cannot declare persistent Story state.'
            : '@let can bind Story state only as a single identifier.',
          base + cursor,
          base + binding.next,
        );
      effects.push({ type: 'bind', binding: binding.pattern, value: value.expression, mutable: name === 'let' });
      index = terminator + 1;
      continue;
    }
    if (name === 'call') {
      const target = /^[A-Za-z_][\w-]*/.exec(source.slice(cursor));
      if (!target) parser.error('EFFECT_CALL', '@call requires an effect name.', base + cursor);
      let end = spaces(source, cursor + target[0].length);
      if (source[end] === '(') end = balanced(source, end, 'js').end;
      const terminator = spaces(source, end);
      if (source[terminator] !== ';')
        parser.error('EFFECT_TERMINATOR', 'Effect directives must end with a semicolon.', base + terminator);
      const call = parser.effectCall(source.slice(cursor, end), base + cursor);
      effects.push({ type: 'call', call });
      index = terminator + 1;
      continue;
    }
    if (name === 'if') {
      if (source[cursor] !== '(') parser.error('EFFECT_IF', '@if requires a parenthesized test.', base + cursor);
      const test = balanced(source, cursor);
      cursor = spaces(source, test.end);
      if (source[cursor] !== '{') parser.error('EFFECT_IF', '@if requires an effect body.', base + cursor);
      const yes = balanced(source, cursor, 'js');
      cursor = spaces(source, yes.end);
      let no: EffectNode[] = [];
      const otherwise = /^@else\b/.exec(source.slice(cursor));
      if (otherwise) {
        cursor = spaces(source, cursor + otherwise[0].length);
        if (source[cursor] !== '{') parser.error('EFFECT_ELSE', '@else requires an effect body.', base + cursor);
        const body = balanced(source, cursor, 'js');
        no = parseEffects(body.content, base + body.start, parser);
        cursor = body.end;
      }
      effects.push({
        type: 'if',
        test: parser.expr(test.content, base + test.start).ast,
        yes: parseEffects(yes.content, base + yes.start, parser),
        no,
      });
      index = cursor;
      continue;
    }
    if (name === 'each') {
      if (source[cursor] !== '(') parser.error('EFFECT_EACH', '@each requires (binding of expression).', base + cursor);
      const clause = balanced(source, cursor);
      const parsed = parseIterationClause(clause.content, parser.span(base + clause.start, base + clause.end));
      cursor = spaces(source, clause.end);
      if (source[cursor] !== '{') parser.error('EFFECT_EACH', '@each requires an effect body.', base + cursor);
      const body = balanced(source, cursor, 'js');
      effects.push({
        type: 'each',
        binding: parsed.binding,
        items: parsed.iterable,
        body: parseEffects(body.content, base + body.start, parser),
      });
      index = body.end;
      continue;
    }
    parser.error('EFFECT_DIRECTIVE', `Unknown effect directive @${name}.`, base + index, base + cursor);
  }
  return effects;
}
