export type IntrinsicPhase = 'render' | 'enter' | 'action';

export interface IntrinsicDefinition {
  readonly id: string;
  readonly names: readonly string[];
  readonly phases: readonly IntrinsicPhase[];
  readonly pure: boolean;
  readonly signature: string;
}

/**
 * One catalog feeds parsing, evaluation, generated code and language tooling.
 * Entries describe portable story semantics, not ambient JavaScript globals.
 */
export const intrinsicCatalog = Object.freeze([
  {
    id: 'math',
    names: ['Math'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: 'Math',
  },
  {
    id: 'number',
    names: ['Number'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: '(value?: unknown) => number',
  },
  {
    id: 'string',
    names: ['String'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: '(value?: unknown) => string',
  },
  {
    id: 'boolean',
    names: ['Boolean'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: '(value?: unknown) => boolean',
  },
  {
    id: 'object',
    names: ['Object'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: 'Pick<ObjectConstructor, "keys" | "values" | "entries">',
  },
  {
    id: 'array-constructor',
    names: ['Array'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: 'Pick<ArrayConstructor, "isArray">',
  },
  {
    id: 'undefined',
    names: ['undefined'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: 'undefined',
  },
  {
    id: 'contains',
    names: ['contains'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: '(container: unknown, value: unknown) => boolean',
  },
  {
    id: 'array',
    names: ['array'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: '<T>(...values: T[]) => T[]',
  },
  {
    id: 'datamap',
    names: ['datamap'],
    phases: ['render', 'enter', 'action'],
    pure: true,
    signature: '(...values: unknown[]) => Record<string, unknown>',
  },
  {
    id: 'random',
    names: ['random'],
    phases: ['enter', 'action'],
    pure: false,
    signature: '(min: number, max: number) => number',
  },
  {
    id: 'either',
    names: ['either'],
    phases: ['enter', 'action'],
    pure: false,
    signature: '<T>(...values: T[]) => T',
  },
] as const satisfies readonly IntrinsicDefinition[]);

const byName = new Map<string, IntrinsicDefinition>();

const byId = new Map<string, IntrinsicDefinition>();

for (const definition of intrinsicCatalog) {
  byId.set(definition.id, definition);
  for (const name of definition.names) byName.set(name, definition);
}

export function intrinsicByName(name: string): IntrinsicDefinition | undefined {
  return byName.get(name);
}

export function intrinsicById(id: string): IntrinsicDefinition | undefined {
  return byId.get(id);
}
