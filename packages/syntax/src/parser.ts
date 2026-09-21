/** Shared markup parser used by all three dialect frontends. */
import {
  GnehError,
  safeKey,
  type CallableCallIR,
  type CallableIR,
  type ContentKind,
  type EffectNode,
  type BindingPattern,
  type Expression,
  type Metadata,
  type Span,
  type StoryNode,
} from '@gneh/core';
import { balanced, splitTopLevel } from './delimiters.js';
import { splitWikiLink, type LinkSeparatorPolicy } from './links.js';

const defaultMaxDepth = 100;

export interface ReadResult {
  nodes: StoryNode[];
  end: number;
  block?: boolean;
}

export type SpecialReader = (
  source: string,
  index: number,
  base: number,
  parser: MarkupParser,
  inline: boolean,
) => ReadResult | undefined;

export type MarkupInlineReader = (
  source: string,
  index: number,
  base: number,
  parser: MarkupParser,
) => ReadResult | undefined;

export type LineEnd = (start: number) => number;

export type MarkupBlockReader = (
  source: string,
  index: number,
  base: number,
  lineEnd: LineEnd,
  parser: MarkupParser,
) => ReadResult | undefined;

export interface HeadingMatch {
  content: string;
  contentOffset: number;
  attrs: Metadata;
}

export interface QuoteMatch {
  content: string;
  contentOffset: number;
  attrs?: Metadata;
}

/**
 * A dialect-owned prose grammar. The shared package only drives the scanner;
 * token spellings and block semantics are selected by the frontend package.
 */
export interface MarkupDialect {
  inline?: MarkupInlineReader;
  inlineMarks?: readonly (readonly [string, ContentKind])[];
  block?: MarkupBlockReader;
  isBlockStart?: (line: string) => boolean;
  heading?: (line: string) => HeadingMatch | undefined;
  rule?: (line: string) => boolean;
  quote?: (line: string) => QuoteMatch | undefined;
  /** How generic wiki links choose among mixed `|`, `->`, and `<-` separators. */
  linkSeparators?: LinkSeparatorPolicy;
  paragraphs?: boolean;
  preserveBlankLines?: boolean;
}

export interface SyntaxOptions {
  file: string;
  /** Dialect-owned expression parser. The shared scanner never selects a language. */
  expression: (source: string, span: Span) => Expression;
  /** Dialect-owned prose grammar. */
  markup: MarkupDialect;
  special?: SpecialReader;
  /** Tell paragraph collection where the calling dialect starts a block construct. */
  isBlockStart?: (line: string) => boolean;
  /** Extend a prose paragraph when an inline dialect construct spans blank lines. */
  extendParagraph?: (source: string, start: number, end: number) => number;
  maxDepth?: number;
  /** Stable enclosing source name used by unnamed top-level callable declarations. */
  contextName?: string;
  initializer?: boolean;
}

/**
 * Shared recursive-descent context used by the three dialect frontends.
 * A parser instance owns passage-level lifecycle and ESM import/export records;
 * callable declarations remain explicit nodes in their lexical source block.
 * Dialect readers plug in at token boundaries and cannot bypass depth/span tracking.
 */
export class MarkupParser {
  evaluation: 'reactive' | 'materialized' = 'reactive';
  readonly constants: Record<string, Expression> = {};
  private depth = 0;
  constructor(readonly options: SyntaxOptions) {}
  get nesting(): number {
    return this.depth;
  }
  get contextName(): string | undefined {
    return this.options.contextName;
  }
  get initializer(): boolean {
    return this.options.initializer ?? false;
  }
  span(start: number, end: number): Span {
    return { file: this.options.file, start, end };
  }
  expr(source: string, start: number): Expression {
    return this.options.expression(source, this.span(start, start + source.length));
  }
  effectCall(source: string, start: number): CallableCallIR {
    const match = /^([A-Za-z_][\w-]*)(?:\(([\s\S]*)\))?$/.exec(source.trim());
    if (!match)
      this.error('EFFECT_CALL', 'Expected an effect name with optional arguments.', start, start + source.length);
    const args = match[2]?.trim()
      ? splitTopLevel(match[2]).map((argument) => this.expr(argument, start + source.indexOf(argument)))
      : [];
    return { callee: { type: 'binding', name: match[1] }, args };
  }
  error(code: string, message: string, start: number, end = start + 1): never {
    throw new GnehError(code, message, this.span(start, end));
  }
  callable(
    phase: CallableIR['phase'],
    name: string | undefined,
    params: BindingPattern[],
    body: CallableIR['body'],
    source: string,
    span: Span,
    capture: CallableIR['capture'] = 'lexical',
  ): CallableIR {
    if (name) safeKey(name);
    return { id: `${span.file}:${span.start}`, phase, capture, name, params, body, source, span };
  }
  addAction(body: EffectNode[], source: string, span: Span, params: BindingPattern[] = []): CallableCallIR {
    return {
      callee: { type: 'inline', callable: this.callable('effect', undefined, params, body, source, span) },
      args: [],
    };
  }
  addView(name: string, params: BindingPattern[], body: StoryNode[], source: string, span: Span): CallableIR {
    return this.callable('view', name, params, body, source, span);
  }
  children(source: string, base: number, inline: boolean): StoryNode[] {
    return inline ? this.inline(source, base) : this.blocks(source, base);
  }
  private guard<T>(fn: () => T): T {
    // All recursive paths pass through one budget, including dialect callbacks.
    if (++this.depth > (this.options.maxDepth ?? defaultMaxDepth))
      throw new GnehError('PARSE_DEPTH', 'Maximum syntax nesting exceeded.');
    try {
      return fn();
    } finally {
      this.depth--;
    }
  }
  attributes(
    raw: string,
    base: number,
  ): {
    attrs: Metadata;
    bindings: Record<string, Expression>;
  } {
    // Static values remain serializable metadata. `{{ ... }}`, `$state`, and
    // `props.*` are kept as expression bindings for extensions to evaluate later.
    const attrs: Metadata = {},
      bindings: Record<string, Expression> = {};
    let i = 0;
    const tokens: string[] = [];
    raw = raw.trim();
    if (raw.startsWith('{') && raw.endsWith('}')) raw = raw.slice(1, -1);
    while (i < raw.length) {
      while (/\s/.test(raw[i] ?? '') && i < raw.length) i++;
      if (i >= raw.length) break;
      const token = /^[.#]([\w-]+)/.exec(raw.slice(i));
      if (token) {
        if (raw[i] === '.') tokens.push(token[1]);
        else attrs.id = token[1];
        i += token[0].length;
        continue;
      }
      const key = /^([A-Za-z_][\w:-]*)\s*=\s*/.exec(raw.slice(i));
      if (!key) this.error('ATTR_SYNTAX', `Invalid attribute near ${raw.slice(i, 30)}`, base + i);
      const name = safeKey(key[1]);
      i += key[0].length;
      if (raw.startsWith('{{', i)) {
        const b = balanced(raw, i);
        bindings[name] = this.expr(b.content.slice(1, -1), base + i + 2);
        i = b.end;
      } else if (raw[i] === '"' || raw[i] === "'") {
        const q = raw[i++];
        let value = '';
        while (i < raw.length && raw[i] !== q) {
          if (raw[i] === '\\') i++;
          value += raw[i++];
        }
        if (raw[i++] !== q) this.error('ATTR_SYNTAX', 'Unclosed attribute string', base + i);
        attrs[name] = value;
      } else {
        const value = /^[^\s]+/.exec(raw.slice(i))![0];
        if (value.startsWith('$') || value.startsWith('props.')) bindings[name] = this.expr(value, base + i);
        else if (value === 'true' || value === 'false') attrs[name] = value === 'true';
        else if (/^[-+]?\d+(\.\d+)?$/.test(value)) attrs[name] = Number(value);
        else attrs[name] = value;
        i += value.length;
      }
    }
    if (tokens.length) attrs.tokens = tokens;
    return { attrs, bindings };
  }
  readSpecial(source: string, index: number, base: number, inline: boolean): ReadResult | undefined {
    return this.options.special?.(source, index, base, this, inline);
  }
  inline(source: string, base = 0): StoryNode[] {
    return this.guard(() => {
      const result: StoryNode[] = [];
      let i = 0,
        start = 0,
        text = '';
      const flush = () => {
        if (text) result.push({ type: 'text', value: text, span: this.span(base + start, base + i) });
        text = '';
        start = i;
      };
      while (i < source.length) {
        const dialect = this.options.markup.inline?.(source, i, base, this);
        if (dialect) {
          flush();
          result.push(...dialect.nodes);
          i = dialect.end;
          start = i;
          continue;
        }
        if (source.startsWith('<!--', i)) {
          flush();
          const end = source.indexOf('-->', i + 4);
          if (end < 0) this.error('COMMENT', 'Unclosed comment', base + i);
          i = end + 3;
          start = i;
          continue;
        }
        if (source.startsWith('[[', i)) {
          // A dialect may assign a longer token beginning with generic link punctuation.
          const longer = source[i + 2] === '[' ? this.readSpecial(source, i, base, true) : undefined;
          if (longer) {
            flush();
            result.push(...longer.nodes);
            i = longer.end;
            start = i;
            continue;
          }
          flush();
          const end = source.indexOf(']]', i + 2);
          if (end < 0) this.error('LINK_CLOSE', 'Unclosed [[link]]', base + i);
          const inside = source.slice(i + 2, end);
          if (inside.includes(']['))
            this.error(
              'LINK_SETTER',
              'Legacy link setters are unsupported. Use a named action.',
              base + i,
              base + end + 2,
            );
          let label = inside.trim(),
            target = inside.trim(),
            action = false;
          let at = inside.indexOf('=>');
          if (at >= 0) {
            label = inside.slice(0, at).trim();
            target = inside.slice(at + 2).trim();
            action = true;
          } else {
            ({ label, target } = splitWikiLink(inside, this.options.markup.linkSeparators));
          }
          const children = this.inline(label, base + i + 2 + inside.indexOf(label));
          const span = this.span(base + i, base + end + 2);
          if (action)
            result.push({
              type: 'button',
              action: this.effectCall(target, base + i + 2 + inside.indexOf(target)),
              children,
              span,
            });
          else {
            let props: Expression | undefined;
            const m = /^([^()]+)\(([\s\S]*)\)$/.exec(target);
            if (m) {
              const exp = m[2];
              props = exp.trim() ? this.expr(exp, base + i + 2 + inside.lastIndexOf(exp)) : undefined;
              target = m[1].trim();
            }
            result.push({ type: 'choice', target, props, children, span });
          }
          i = end + 2;
          start = i;
          continue;
        }
        if (source[i] === '$' && /^[A-Za-z_]/.test(source[i + 1] ?? '')) {
          flush();
          const name = /^\$[A-Za-z_]\w*/.exec(source.slice(i))![0];
          result.push({
            type: 'value',
            expression: this.expr(name, base + i),
            span: this.span(base + i, base + i + name.length),
          });
          i += name.length;
          start = i;
          continue;
        }
        const special = this.readSpecial(source, i, base, true);
        if (special) {
          flush();
          result.push(...special.nodes);
          i = special.end;
          start = i;
          continue;
        }
        let marked = false;
        for (const [mark, kind] of this.options.markup.inlineMarks ?? []) {
          if (source.startsWith(mark, i)) {
            const end = source.indexOf(mark, i + mark.length);
            if (end >= i + mark.length) {
              flush();
              result.push({
                type: 'content',
                kind,
                attrs: {},
                children: this.inline(source.slice(i + mark.length, end), base + i + mark.length),
                span: this.span(base + i, base + end + mark.length),
              });
              i = end + mark.length;
              start = i;
              marked = true;
              break;
            }
          }
        }
        if (marked) continue;
        text += source[i];
        i++;
      }
      flush();
      return result;
    });
  }
  blocks(source: string, base = 0): StoryNode[] {
    return this.guard(() => {
      const result: StoryNode[] = [];
      let i = 0;
      const lineEnd = (start: number) => {
        const end = source.indexOf('\n', start);
        return end < 0 ? source.length : end + 1;
      };
      const isStart = (line: string) =>
        !!this.options.isBlockStart?.(line) || !!this.options.markup.isBlockStart?.(line);
      const paragraphs = this.options.markup.paragraphs ?? true;
      while (i < source.length) {
        let end = lineEnd(i);
        const line = source.slice(i, end).replace(/\r?\n$/, '');
        if (!line.trim()) {
          if (this.options.markup.preserveBlankLines) result.push(...this.inline(source.slice(i, end), base + i));
          i = end;
          continue;
        }
        const leading = line.length - line.trimStart().length;
        const start = i + leading;
        const dialect = this.options.markup.block?.(source, i, base, lineEnd, this);
        if (dialect) {
          result.push(...dialect.nodes);
          i = dialect.end;
          continue;
        }
        const special = this.readSpecial(source, start, base, false);
        if (special) {
          if (special.block) {
            result.push(...special.nodes);
            i = special.end;
          } else {
            const tailEnd = lineEnd(special.end);
            const tail = paragraphs
              ? source.slice(special.end, tailEnd).replace(/\r?\n$/, '')
              : source.slice(special.end, tailEnd);
            const children = [...special.nodes, ...this.inline(tail, base + special.end)];
            if (paragraphs)
              result.push({
                type: 'content',
                kind: 'paragraph',
                attrs: {},
                children,
                span: this.span(base + start, base + tailEnd),
              });
            else result.push(...children);
            i = tailEnd;
          }
          continue;
        }
        const heading = this.options.markup.heading?.(line);
        if (heading) {
          result.push({
            type: 'content',
            kind: 'heading',
            attrs: heading.attrs,
            children: this.inline(heading.content, base + i + heading.contentOffset),
            span: this.span(base + i, base + end),
          });
          i = end;
          continue;
        }
        if (this.options.markup.rule?.(line)) {
          result.push({
            type: 'content',
            kind: 'rule',
            attrs: {},
            children: [],
            span: this.span(base + i, base + end),
          });
          i = end;
          continue;
        }
        const quote = this.options.markup.quote?.(line);
        if (quote) {
          result.push({
            type: 'content',
            kind: 'quote',
            attrs: quote.attrs ?? {},
            children: this.inline(quote.content, base + i + quote.contentOffset),
            span: this.span(base + i, base + end),
          });
          i = end;
          continue;
        }
        // Paragraphs stop at syntax boundaries; embedded dialect nodes remain structured children.
        let cursor = end;
        while (cursor < source.length) {
          const e = lineEnd(cursor),
            next = source.slice(cursor, e);
          if (isStart(next)) break;
          cursor = e;
        }
        cursor = this.options.extendParagraph?.(source, i, cursor) ?? cursor;
        const text = paragraphs ? source.slice(i, cursor).replace(/\r?\n$/, '') : source.slice(i, cursor);
        if (paragraphs)
          result.push({
            type: 'content',
            kind: 'paragraph',
            attrs: {},
            children: this.inline(text, base + i),
            span: this.span(base + i, base + cursor),
          });
        else result.push(...this.inline(text, base + i));
        i = cursor;
      }
      return result;
    });
  }
}
