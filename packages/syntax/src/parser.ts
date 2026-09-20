/** Shared markup parser used by all three dialect frontends. */
import {
  GnehError,
  safeKey,
  type ContentKind,
  type EffectDeclarationIR,
  type EffectCallIR,
  type EffectNode,
  type BindingPattern,
  type Expression,
  type ImportIR,
  type Metadata,
  type Span,
  type StoryNode,
  type ViewDeclarationIR,
} from '@gneh/core';
import { balanced, splitTopLevel, type Balanced } from './delimiters.js';
import { readLegacyList, readMarkdownCodeFence, readSugarCodeBlock } from './legacy-blocks.js';
import {
  isProfileRule,
  literalNodes,
  profileBlockStart,
  profileHeading,
  profileMarks,
  profileQuote,
  readHarloweCollapse,
  readHarloweCombinedEmphasis,
  type MarkupProfile,
} from './profiles.js';

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
  /** Select the source format's built-in prose markup rather than assuming Markdown. */
  markupProfile?: MarkupProfile;
  /** Tell paragraph collection where the calling dialect starts a block construct. */
  isBlockStart?: (line: string) => boolean;
  /** Extend a prose paragraph when an inline dialect construct spans blank lines. */
  extendParagraph?: (source: string, start: number, end: number) => number;
  /** Preserve prose line endings as semantic breaks instead of Markdown soft breaks. */
  hardLineBreaks?: boolean;
  maxDepth?: number;
}

/**
 * Shared recursive-descent scanner for Inkdown plus the two compatibility dialects.
 * A parser instance owns passage-level enter/effect/view declarations and ESM
 * import/export records while every reader returns only renderer-neutral nodes.
 * Dialect readers plug in at token boundaries and cannot bypass depth/span tracking.
 */
export class MarkupParser {
  evaluation: 'reactive' | 'materialized' = 'reactive';
  readonly enter: EffectNode[] = [];
  readonly effects: Record<string, EffectDeclarationIR> = {};
  readonly views: Record<string, ViewDeclarationIR> = {};
  readonly constants: Record<string, Expression> = {};
  readonly imports: ImportIR[] = [];
  readonly exports: string[] = [];
  private depth = 0;
  private actionNumber = 0;
  constructor(readonly options: SyntaxOptions) {}
  get nesting(): number {
    return this.depth;
  }
  addEnter(effects: EffectNode[]): void {
    this.enter.push(...effects);
  }
  span(start: number, end: number): Span {
    return { file: this.options.file, start, end };
  }
  expr(source: string, start: number): Expression {
    return this.options.expression(source, this.span(start, start + source.length));
  }
  effectCall(source: string, start: number): EffectCallIR {
    const match = /^([A-Za-z_][\w-]*)(?:\(([\s\S]*)\))?$/.exec(source.trim());
    if (!match)
      this.error('EFFECT_CALL', 'Expected an effect name with optional arguments.', start, start + source.length);
    const args = match[2]?.trim()
      ? splitTopLevel(match[2]).map((argument) => this.expr(argument, start + source.indexOf(argument)).ast)
      : [];
    return { name: match[1], args };
  }
  error(code: string, message: string, start: number, end = start + 1): never {
    throw new GnehError(code, message, this.span(start, end));
  }
  addAction(
    body: EffectNode[],
    source: string,
    span: Span,
    name = `__action${this.actionNumber++}`,
    params: BindingPattern[] = [],
  ): EffectCallIR {
    safeKey(name);
    if (this.effects[name]) this.error('DUPLICATE_ACTION', `Duplicate action ${name}`, span.start, span.end);
    this.effects[name] = { phase: 'effect', name, params, body, source, span };
    return { name, args: [] };
  }
  addView(name: string, params: BindingPattern[], body: StoryNode[], source: string, span: Span): void {
    safeKey(name);
    if (this.views[name]) this.error('DUPLICATE_VIEW', `Duplicate view ${name}`, span.start, span.end);
    this.views[name] = { phase: 'view', name, params, body, source, span };
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
      const profile = this.options.markupProfile ?? 'markdown';
      const hardLineBreaks = this.options.hardLineBreaks ?? profile !== 'markdown';
      const flush = () => {
        if (text) result.push({ type: 'text', value: text, span: this.span(base + start, base + i) });
        text = '';
        start = i;
      };
      while (i < source.length) {
        const c = source[i];
        if (hardLineBreaks && c === '\\') {
          const continuation =
            profile === 'sugarcube'
              ? /^\\[^\S\r\n]*(?:\r\n|\r|\n)/.exec(source.slice(i))
              : /^\\(?:\r\n|\r|\n)/.exec(source.slice(i));
          if (continuation) {
            i += continuation[0].length;
            continue;
          }
        }
        if (hardLineBreaks && (c === '\n' || c === '\r')) {
          const width = c === '\r' && source[i + 1] === '\n' ? 2 : 1;
          const continuation =
            profile === 'sugarcube'
              ? /^[^\S\r\n]*\\/.exec(source.slice(i + width))
              : source[i + width] === '\\'
                ? ['\\']
                : undefined;
          if (continuation) {
            i += width + continuation[0].length;
            continue;
          }
          flush();
          result.push({
            type: 'content',
            kind: 'break',
            attrs: {},
            children: [],
            span: this.span(base + i, base + i + width),
          });
          i += width;
          start = i;
          continue;
        }
        if (profile === 'markdown' && c === '\\' && i + 1 < source.length) {
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
        if (profile === 'sugarcube' && (source.startsWith('/*', i) || source.startsWith('/%', i))) {
          flush();
          const opener = source.slice(i, i + 2),
            closer = opener === '/*' ? '*/' : '%/',
            end = source.indexOf(closer, i + 2);
          if (end < 0) this.error('COMMENT', `Unclosed ${opener} comment`, base + i);
          i = end + 2;
          start = i;
          continue;
        }
        if (profile === 'sugarcube' && source.startsWith('"""', i)) {
          const end = source.indexOf('"""', i + 3);
          if (end >= 0) {
            flush();
            result.push(...literalNodes(source.slice(i + 3, end), base, i + 3, this));
            i = end + 3;
            start = i;
            continue;
          }
        }
        if (profile === 'harlowe' && c === '{') {
          const collapsed = readHarloweCollapse(source, i, base, this);
          if (collapsed) {
            flush();
            result.push(collapsed.node);
            i = collapsed.end;
            start = i;
            continue;
          }
        }
        if (profile === 'sugarcube' && source.startsWith('{{{', i)) {
          const end = source.indexOf('}}}', i + 3);
          if (end >= 0) {
            flush();
            result.push({
              type: 'content',
              kind: 'code',
              attrs: {},
              children: [
                {
                  type: 'text',
                  value: source.slice(i + 3, end),
                  span: this.span(base + i + 3, base + end),
                },
              ],
              span: this.span(base + i, base + end + 3),
            });
            i = end + 3;
            start = i;
            continue;
          }
        }
        if (c === '`') {
          let count = 1;
          while (source[i + count] === '`') count++;
          const end = source.indexOf('`'.repeat(count), i + count);
          if (end >= 0) {
            flush();
            if (profile === 'harlowe')
              result.push({
                type: 'content',
                kind: 'span',
                attrs: { verbatim: true },
                children: literalNodes(source.slice(i + count, end), base, i + count, this),
                span: this.span(base + i, base + end + count),
              });
            else
              result.push({
                type: 'content',
                kind: 'code',
                attrs: {},
                children: [
                  {
                    type: 'text',
                    value: source.slice(i + count, end).replace(/\r?\n/g, ' '),
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
        if (profile === 'markdown' && source.startsWith('{{', i)) {
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
        if (
          (c === '$' ||
            (profile !== 'markdown' &&
              c === '_' &&
              !(profile === 'sugarcube' && source[i + 1] === '_') &&
              !/[\w$]/.test(source[i - 1] ?? ''))) &&
          /^[A-Za-z_]/.test(source[i + 1] ?? '')
        ) {
          flush();
          const name = /^[$_][A-Za-z_]\w*/.exec(source.slice(i))![0];
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
        if (profile === 'harlowe' && source.startsWith('***', i)) {
          const combined = readHarloweCombinedEmphasis(source, i, base, this);
          if (combined) {
            flush();
            result.push(combined.node);
            i = combined.end;
            start = i;
            continue;
          }
        }
        const marks = [...(this.options.inlineMarks ?? []), ...profileMarks[profile]];
        let marked = false;
        for (const [mark, kind] of marks) {
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
        if (profile === 'markdown' && (c === '[' || (c === '!' && source[i + 1] === '['))) {
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
      const profile = this.options.markupProfile ?? 'markdown';
      const lineEnd = (start: number) => {
        const end = source.indexOf('\n', start);
        return end < 0 ? source.length : end + 1;
      };
      const isStart = (line: string) => {
        if (this.options.isBlockStart?.(line)) return true;
        return profileBlockStart(line, profile);
      };
      while (i < source.length) {
        let end = lineEnd(i);
        const line = source.slice(i, end).replace(/\r?\n$/, '');
        if (!line.trim()) {
          if (profile !== 'markdown') result.push(...this.inline(source.slice(i, end), base + i));
          i = end;
          continue;
        }
        const leading = line.length - line.trimStart().length;
        const start = i + leading;
        if (profile === 'markdown') {
          const fence = readMarkdownCodeFence(source, i, base, lineEnd, this);
          if (fence) {
            result.push(fence.node);
            i = fence.end;
            continue;
          }
        }
        if (profile === 'sugarcube') {
          const code = readSugarCodeBlock(source, i, base, lineEnd, this);
          if (code) {
            result.push(code.node);
            i = code.end;
            continue;
          }
        }
        if (profile === 'markdown' && line.trimStart().startsWith(':::')) {
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
            const tail =
              profile === 'markdown'
                ? source.slice(special.end, tailEnd).replace(/\r?\n$/, '')
                : source.slice(special.end, tailEnd);
            const children = [...special.nodes, ...this.inline(tail, base + special.end)];
            if (profile === 'markdown')
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
        const heading = profileHeading(line, profile);
        if (heading) {
          let content = heading[2],
            attrs: Metadata = { level: heading[1].length };
          const attr = profile === 'markdown' ? /\s+(\{[.#][^}]*\})$/.exec(content) : undefined;
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
        if (isProfileRule(line, profile)) {
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
        const list = profile === 'markdown' ? /^ {0,3}([-*+]|\d+\.)\s+(.*)$/.exec(line) : undefined;
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
        const legacy = readLegacyList(source, i, base, profile, lineEnd, this);
        if (legacy) {
          result.push(...legacy.nodes);
          i = legacy.end;
          continue;
        }
        const quote = profileQuote(line, profile);
        if (quote) {
          result.push({
            type: 'content',
            kind: 'quote',
            attrs: profile === 'sugarcube' ? { depth: quote[1].length } : {},
            children: this.inline(
              quote[profile === 'sugarcube' ? 2 : 1],
              base + i + line.indexOf(quote[profile === 'sugarcube' ? 2 : 1]),
            ),
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
        const text = profile === 'markdown' ? source.slice(i, cursor).replace(/\r?\n$/, '') : source.slice(i, cursor);
        if (profile === 'markdown')
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
