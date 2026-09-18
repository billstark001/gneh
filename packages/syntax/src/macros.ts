import { GnehError } from '@gneh/core';
import type { MarkupParser, ReadResult } from './parser.js';

export type MacroNameNormalizer = (name: string) => string;

export const exactMacroName: MacroNameNormalizer = (name) => name;

export const caseInsensitiveMacroName: MacroNameNormalizer = (name) => name.toLowerCase();

/** Harlowe macro names are ASCII-case-insensitive and may omit internal hyphens. */
export const harloweMacroName: MacroNameNormalizer = (name) => name.toLowerCase().replaceAll('-', '');

export interface MacroLoweringInvocation<Node, Meta = undefined> {
  /** Canonical name after this registry's normalization policy. */
  name: string;
  /** Name as provided by the dialect token. */
  rawName: string;
  source: string;
  index: number;
  base: number;
  parser: MarkupParser;
  inline: boolean;
  node: Node;
  lowerings: MacroLoweringRegistry<Node, Meta>;
}

export type MacroLowering<Node, Meta = undefined> = (
  invocation: MacroLoweringInvocation<Node, Meta>,
) => ReadResult | undefined;

export interface MacroLoweringDefinition<Token, Meta = undefined> {
  readonly name: string;
  readonly handler: MacroLowering<Token, Meta>;
  readonly meta: Meta | undefined;
}

export interface RegisterMacroLoweringOptions<Meta> {
  /** Replace an existing canonical name explicitly; accidental collisions throw. */
  replace?: boolean;
  meta?: Meta;
}

/**
 * Dialect-neutral macro dispatch. A registry is caller-owned and contains no global
 * mutable state; dialect packages decide how source is tokenized and lowered.
 */
export class MacroLoweringRegistry<Token, Meta = undefined> {
  readonly normalize: MacroNameNormalizer;
  private readonly definitions = new Map<string, MacroLoweringDefinition<Token, Meta>>();

  constructor(normalize: MacroNameNormalizer = exactMacroName) {
    this.normalize = normalize;
  }

  register(
    names: string | readonly string[],
    handler: MacroLowering<Token, Meta>,
    options: RegisterMacroLoweringOptions<Meta> = {},
  ): this {
    const requested = typeof names === 'string' ? [names] : names;
    const canonical = [...new Set(requested.map((name) => this.normalize(name)))];
    for (const name of canonical) {
      if (!name) throw new GnehError('MACRO_NAME', 'A macro name cannot be empty.');
      if (!options.replace && this.definitions.has(name))
        throw new GnehError('MACRO_DUPLICATE', `Macro is already registered: ${name}`);
    }
    for (const name of canonical) this.definitions.set(name, { name, handler, meta: options.meta });
    return this;
  }

  unregister(name: string): boolean {
    return this.definitions.delete(this.normalize(name));
  }

  resolve(name: string): MacroLoweringDefinition<Token, Meta> | undefined {
    return this.definitions.get(this.normalize(name));
  }

  has(name: string): boolean {
    return this.definitions.has(this.normalize(name));
  }

  lower(
    rawName: string,
    context: Omit<MacroLoweringInvocation<Token, Meta>, 'name' | 'rawName' | 'lowerings'>,
  ): ReadResult | undefined {
    const name = this.normalize(rawName);
    const definition = this.definitions.get(name);
    return definition?.handler({ ...context, name, rawName, lowerings: this });
  }

  entries(): MacroLoweringDefinition<Token, Meta>[] {
    return [...this.definitions.values()];
  }

  clone(): MacroLoweringRegistry<Token, Meta> {
    const copy = new MacroLoweringRegistry<Token, Meta>(this.normalize);
    for (const definition of this.definitions.values()) copy.definitions.set(definition.name, definition);
    return copy;
  }
}
