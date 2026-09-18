/** Shared markup parser used by all three dialect frontends. */
import {
  GnehError,
  safeKey,
  type ActionIR,
  type ContentKind,
  type Expression,
  type Metadata,
  type Span,
  type Statement,
  type StoryNode,
} from '@gneh/core';
import { balanced, type Balanced } from './delimiters.js';

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

export interface SyntaxOptions {
  file: string;
  /** Dialect-owned expression parser. The shared scanner never selects a language. */
  expression: (source: string, span: Span) => Expression;
  special?: SpecialReader;
  /** Extra inline delimiter pairs owned by the calling dialect. */
  inlineMarks?: readonly (readonly [string, ContentKind])[];
  /** Tell paragraph collection where the calling dialect starts a block construct. */
  isBlockStart?: (line: string) => boolean;
  /** Extend a prose paragraph when an inline dialect construct spans blank lines. */
  extendParagraph?: (source: string, start: number, end: number) => number;
  maxDepth?: number;
}

/**
 * Shared recursive-descent scanner for Inkdown plus the two compatibility dialects.
 * A parser instance owns the passage-level declaration side channels (`enter`,
 * `actions`, and `module`) while every reader returns only renderer-neutral nodes.
 * Dialect readers plug in at token boundaries and cannot bypass depth/span tracking.
 */
export class MarkupParser {
  readonly enter: Statement[] = [];
  readonly actions: Record<string, ActionIR> = {};
  module = '';
  imports: string[] = [];
  private depth = 0;
  private actionNumber = 0;
  private readonly enterScopes: Statement[][] = [];
  constructor(readonly options: SyntaxOptions) {}
  get nesting(): number {
    return this.depth;
  }
  get collectingEnter(): boolean {
    return this.enterScopes.length > 0;
  }
  addEnter(statements: Statement[]): void {
    (this.enterScopes.at(-1) ?? this.enter).push(...statements);
  }
  /**
   * Keep enter effects found in a structural branch local until the dialect wraps
   * them in the corresponding conditional or loop statement.
   */
  captureEnter<T>(read: () => T): { value: T; statements: Statement[] } {
    const statements: Statement[] = [];
    this.enterScopes.push(statements);
    try {
      return { value: read(), statements };
    } finally {
      this.enterScopes.pop();
    }
  }
  span(start: number, end: number): Span {
    return { file: this.options.file, start, end };
  }
  expr(source: string, start: number): Expression {
    return this.options.expression(source, this.span(start, start + source.length));
  }
  error(code: string, message: string, start: number, end = start + 1): never {
    throw new GnehError(code, message, this.span(start, end));
  }
  addAction(statements: Statement[], source: string, span: Span, name = `__action${this.actionNumber++}`): string {
    safeKey(name);
    if (this.actions[name]) this.error('DUPLICATE_ACTION', `Duplicate action ${name}`, span.start, span.end);
    this.actions[name] = { name, statements, source, span };
    return name;
  }
  children(source: string, base: number, inline: boolean): StoryNode[] {
    return inline ? this.inline(source, base) : this.blocks(source, base);
  }
  private guard<T>(fn: () => T): T {
    // All recursive paths pass through one budget, including dialect callbacks.
    if (++this.depth > (this.options.maxDepth ?? 100))
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
    // The scanner accumulates ordinary prose and flushes it only at semantic
    // boundaries. This preserves exact source spans without a second token stream.
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
        const c = source[i];
        if (c === '\\' && i + 1 < source.length) {
          text += source[i + 1];
          i += 2;
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
        if (c === '`') {
          let count = 1;
          while (source[i + count] === '`') count++;
          const end = source.indexOf('`'.repeat(count), i + count);
          if (end >= 0) {
            flush();
            result.push({
              type: 'content',
              kind: 'code',
              attrs: {},
              children: [
                {
                  type: 'text',
                  value: source.slice(i + count, end).replace(/\n/g, ' '),
                  span: this.span(base + i + count, base + end),
                },
              ],
              span: this.span(base + i, base + end + count),
            });
            i = end + count;
            start = i;
            continue;
          }
        }
        if (source.startsWith('{{', i)) {
          flush();
          const b = balanced(source, i);
          if (source[b.end - 2] !== '}') this.error('VALUE_CLOSE', 'Expected }}', base + i);
          const exp = b.content.slice(1, -1);
          result.push({
            type: 'value',
            expression: this.expr(exp, base + i + 2),
            span: this.span(base + i, base + b.end),
          });
          i = b.end;
          start = i;
          continue;
        }
        if (source.startsWith('[[', i)) {
          // A dialect may assign a longer token beginning with generic link
          // punctuation. Karlowe uses `[[[link]]]` for a hook containing a link.
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
          } else if ((at = inside.indexOf('->')) >= 0) {
            label = inside.slice(0, at).trim();
            target = inside.slice(at + 2).trim();
          } else if ((at = inside.indexOf('<-')) >= 0) {
            target = inside.slice(0, at).trim();
            label = inside.slice(at + 2).trim();
          } else if ((at = inside.indexOf('|')) >= 0) {
            label = inside.slice(0, at).trim();
            target = inside.slice(at + 1).trim();
          }
          const children = this.inline(label, base + i + 2 + inside.indexOf(label));
          const span = this.span(base + i, base + end + 2);
          if (action) result.push({ type: 'button', action: target, children, span });
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
        if (c === '$' && /^[A-Za-z_]/.test(source[i + 1] ?? '')) {
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
        const marks: (readonly [string, ContentKind])[] = [
          ...(this.options.inlineMarks ?? []),
          ['**', 'strong'],
          ['__', 'strong'],
          ['~~', 'strike'],
          ['*', 'emphasis'],
          ['_', 'emphasis'],
        ];
        let marked = false;
        for (const [mark, kind] of marks) {
          if (source.startsWith(mark, i)) {
            const end = source.indexOf(mark, i + mark.length);
            if (end > i + mark.length) {
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
        if (c === '[' || (c === '!' && source[i + 1] === '[')) {
          const image = c === '!',
            bracket = i + (image ? 1 : 0);
          let b: Balanced | undefined;
          try {
            b = balanced(source, bracket, 'markup');
          } catch {}
          if (b) {
            const next = source[b.end];
            if (next === '(') {
              const destination = balanced(source, b.end);
              flush();
              const url = destination.content.trim().replace(/^<|>$/g, '');
              result.push({
                type: 'content',
                kind: image ? 'image' : 'link',
                attrs: image ? { src: url, alt: b.content } : { href: url },
                children: image ? [] : this.inline(b.content, base + b.start),
                span: this.span(base + i, base + destination.end),
              });
              i = destination.end;
              start = i;
              continue;
            }
            if (next === '{' && !image) {
              const a = balanced(source, b.end);
              const parsed = this.attributes(a.content, base + a.start);
              if (Object.keys(parsed.bindings).length)
                this.error('STYLE_BINDING', 'Dynamic attributes belong on extension containers.', base + i);
              flush();
              result.push({
                type: 'content',
                kind: 'span',
                attrs: parsed.attrs,
                children: this.inline(b.content, base + b.start),
                span: this.span(base + i, base + a.end),
              });
              i = a.end;
              start = i;
              continue;
            }
          }
        }
        text += c;
        i++;
      }
      flush();
      return result;
    });
  }
  blocks(source: string, base = 0): StoryNode[] {
    // Block recognition is line-oriented; inline parsing is delegated only after
    // the complete extent of a block has been found.
    return this.guard(() => {
      const result: StoryNode[] = [];
      let i = 0;
      const lineEnd = (start: number) => {
        const end = source.indexOf('\n', start);
        return end < 0 ? source.length : end + 1;
      };
      const isStart = (line: string) =>
        /^\s*$|^ {0,3}(?:#{1,6}\s|>\s?|[-*+]\s|\d+\.\s|`{3,}|~{3,}|:::) /.test(line) ||
        !!this.options.isBlockStart?.(line);
      while (i < source.length) {
        let end = lineEnd(i);
        const line = source.slice(i, end).replace(/\r?\n$/, '');
        if (!line.trim()) {
          i = end;
          continue;
        }
        const leading = line.length - line.trimStart().length;
        const start = i + leading;
        const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
        if (fence) {
          const marker = fence[1],
            bodyStart = end;
          let cursor = end,
            found = false;
          while (cursor < source.length) {
            const e = lineEnd(cursor);
            const l = source.slice(cursor, e).trim();
            if (l[0] === marker[0] && l.length >= marker.length && [...l].every((c) => c === marker[0])) {
              end = e;
              found = true;
              break;
            }
            cursor = e;
          }
          if (!found) this.error('CODE_FENCE', 'Unclosed code fence.', base + i);
          result.push({
            type: 'content',
            kind: 'code-block',
            attrs: { language: fence[2].trim() },
            children: [
              {
                type: 'text',
                value: source.slice(bodyStart, cursor).replace(/\r?\n$/, ''),
                span: this.span(base + bodyStart, base + cursor),
              },
            ],
            span: this.span(base + i, base + end),
          });
          i = end;
          continue;
        }
        if (line.trimStart().startsWith(':::')) {
          const rest = line.trim().slice(3).trim();
          if (!rest) this.error('CONTAINER_CLOSE', 'Unexpected container terminator.', base + i);
          let name = 'box',
            attr = rest;
          const m = /^([\w:-]+)\s*(.*)$/.exec(rest);
          if (m) {
            name = m[1];
            attr = m[2];
          }
          const parsed = this.attributes(attr, base + start + 3 + rest.indexOf(attr));
          let depth = 1,
            cursor = end,
            bodyEnd = end;
          let codeFence = '';
          while (cursor < source.length) {
            const e = lineEnd(cursor),
              l = source.slice(cursor, e).trim();
            if (/^(`{3,}|~{3,})/.test(l)) {
              if (!codeFence) codeFence = l[0];
              else if (l[0] === codeFence) codeFence = '';
            }
            if (!codeFence && l.startsWith(':::')) {
              if (l === ':::') depth--;
              else depth++;
              if (!depth) {
                bodyEnd = cursor;
                end = e;
                break;
              }
            }
            cursor = e;
          }
          if (depth) this.error('CONTAINER_CLOSE', 'Unclosed ::: container.', base + i);
          const bodyStart = lineEnd(i);
          result.push({
            type: 'extension',
            name,
            attrs: parsed.attrs,
            bindings: parsed.bindings,
            children: this.blocks(source.slice(bodyStart, bodyEnd), base + bodyStart),
            span: this.span(base + i, base + end),
          });
          i = end;
          continue;
        }
        const special = this.readSpecial(source, start, base, false);
        if (special) {
          if (special.block) {
            result.push(...special.nodes);
            i = special.end;
          } else {
            const tailEnd = lineEnd(special.end);
            const tail = source.slice(special.end, tailEnd).replace(/\r?\n$/, '');
            result.push({
              type: 'content',
              kind: 'paragraph',
              attrs: {},
              children: [...special.nodes, ...this.inline(tail, base + special.end)],
              span: this.span(base + start, base + tailEnd),
            });
            i = tailEnd;
          }
          continue;
        }
        const heading = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
        if (heading) {
          let content = heading[2],
            attrs: Metadata = { level: heading[1].length };
          const attr = /\s+(\{[.#][^}]*\})$/.exec(content);
          if (attr) {
            attrs = {
              ...attrs,
              ...this.attributes(attr[1], base + i + line.indexOf(attr[1])).attrs,
            };
            content = content.slice(0, attr.index);
          }
          result.push({
            type: 'content',
            kind: 'heading',
            attrs,
            children: this.inline(content, base + i + line.indexOf(content)),
            span: this.span(base + i, base + end),
          });
          i = end;
          continue;
        }
        if (/^ {0,3}(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
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
        const list = /^ {0,3}([-*+]|\d+\.)\s+(.*)$/.exec(line);
        if (list) {
          const children: StoryNode[] = [];
          const ordered = /\d/.test(list[1]);
          let cursor = i;
          while (cursor < source.length) {
            const e = lineEnd(cursor),
              l = source.slice(cursor, e).replace(/\r?\n$/, '');
            const m = /^ {0,3}([-*+]|\d+\.)\s+(.*)$/.exec(l);
            if (!m || /\d/.test(m[1]) !== ordered) break;
            children.push({
              type: 'content',
              kind: 'item',
              attrs: {},
              children: this.inline(m[2], base + cursor + l.indexOf(m[2])),
              span: this.span(base + cursor, base + e),
            });
            cursor = e;
          }
          result.push({
            type: 'content',
            kind: 'list',
            attrs: { ordered },
            children,
            span: this.span(base + i, base + cursor),
          });
          i = cursor;
          continue;
        }
        const quote = /^ {0,3}>\s?(.*)$/.exec(line);
        if (quote) {
          result.push({
            type: 'content',
            kind: 'quote',
            attrs: {},
            children: this.inline(quote[1], base + i + line.indexOf(quote[1])),
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
          if (isStart(next) || /^ {0,3}(?:#{1,6}\s|>\s?|[-*+]\s|\d+\.\s|`{3,}|~{3,}|:::)/.test(next)) break;
          cursor = e;
        }
        cursor = this.options.extendParagraph?.(source, i, cursor) ?? cursor;
        const text = source.slice(i, cursor).replace(/\r?\n$/, '');
        result.push({
          type: 'content',
          kind: 'paragraph',
          attrs: {},
          children: this.inline(text, base + i),
          span: this.span(base + i, base + cursor),
        });
        i = cursor;
      }
      return result;
    });
  }
}
