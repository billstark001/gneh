import type { Json, State } from '../../core/dist/index.js';

export type Dialect = 'inkdown' | 'karlowe' | 'sugarcast';

export type Projection = 'text' | 'xml';

export type CaseStep =
  | { activate: string }
  | { change: { target: string; value: Json } }
  | { navigate: { target: string; props?: State } }
  | { save: string }
  | { load: string }
  | { reset: true }
  | { undo: true }
  | { redo: true };

export interface CaseOptions {
  state?: State;
  entry?: string;
  steps?: CaseStep[];
  expect?: {
    state?: State;
    current?: string;
    registrations?: string[];
    canUndo?: boolean;
    canRedo?: boolean;
    error?: true;
  };
}

export interface ConformanceCase {
  file: string;
  group: string;
  name: string;
  dialect: Dialect;
  input: string;
  projection: Projection;
  output: string;
  options: CaseOptions;
}

const inputLanguages = new Set<Dialect>(['inkdown', 'karlowe', 'sugarcast']);
const outputLanguages = new Set<Projection>(['text', 'xml']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseOptions(value: string, file: string, name: string): CaseOptions {
  const parsed = JSON.parse(value) as CaseOptions;
  if (!isRecord(parsed)) throw new Error(`${file}: ${name}: json options must be an object`);
  const unknown = Object.keys(parsed).filter((key) => !['state', 'entry', 'steps', 'expect'].includes(key));
  if (unknown.length) throw new Error(`${file}: ${name}: unknown options: ${unknown.join(', ')}`);
  if (parsed.state !== undefined && !isRecord(parsed.state))
    throw new Error(`${file}: ${name}: state must be an object`);
  if (parsed.entry !== undefined && typeof parsed.entry !== 'string')
    throw new Error(`${file}: ${name}: entry must be a string`);
  if (
    parsed.steps &&
    (!Array.isArray(parsed.steps) ||
      parsed.steps.some((step) => {
        if (!isRecord(step) || Object.keys(step).length !== 1) return true;
        if (typeof step.activate === 'string' || typeof step.save === 'string' || typeof step.load === 'string')
          return false;
        if (step.reset === true || step.undo === true || step.redo === true) return false;
        if (isRecord(step.change) && typeof step.change.target === 'string' && Object.hasOwn(step.change, 'value'))
          return false;
        return !(
          isRecord(step.navigate) &&
          typeof step.navigate.target === 'string' &&
          (step.navigate.props === undefined || isRecord(step.navigate.props))
        );
      }))
  )
    throw new Error(`${file}: ${name}: each step must contain one valid operation`);
  if (parsed.expect) {
    if (!isRecord(parsed.expect)) throw new Error(`${file}: ${name}: expect must be an object`);
    const unknownExpectations = Object.keys(parsed.expect).filter(
      (key) => !['state', 'current', 'registrations', 'canUndo', 'canRedo', 'error'].includes(key),
    );
    if (unknownExpectations.length)
      throw new Error(`${file}: ${name}: unknown expectations: ${unknownExpectations.join(', ')}`);
    if (parsed.expect.state !== undefined && !isRecord(parsed.expect.state))
      throw new Error(`${file}: ${name}: expected state must be an object`);
    if (parsed.expect.current !== undefined && typeof parsed.expect.current !== 'string')
      throw new Error(`${file}: ${name}: expected current route must be a string`);
    if (
      parsed.expect.registrations !== undefined &&
      (!Array.isArray(parsed.expect.registrations) ||
        parsed.expect.registrations.some((registration) => typeof registration !== 'string'))
    )
      throw new Error(`${file}: ${name}: expected registrations must be string names`);
    for (const key of ['canUndo', 'canRedo'] as const)
      if (parsed.expect[key] !== undefined && typeof parsed.expect[key] !== 'boolean')
        throw new Error(`${file}: ${name}: expected ${key} must be a boolean`);
    if (parsed.expect.error !== undefined && parsed.expect.error !== true)
      throw new Error(`${file}: ${name}: expected error must be true`);
  }
  return parsed;
}

export function parseConformance(source: string, file: string): ConformanceCase[] {
  const lines = source.replaceAll('\r\n', '\n').split('\n');
  const cases: ConformanceCase[] = [];
  let title = '';
  let group = '';
  let current:
    | {
        name: string;
        input?: { language: Dialect; value: string };
        output?: { language: Projection; value: string };
        options?: CaseOptions;
      }
    | undefined;
  let separated = true;

  const finish = () => {
    if (!current) return;
    if (!current.input || !current.output)
      throw new Error(`${file}: ${current.name}: expected one dialect input and one text/xml output fence`);
    cases.push({
      file,
      group,
      name: current.name,
      dialect: current.input.language,
      input: current.input.value,
      projection: current.output.language,
      output: current.output.value,
      options: current.options ?? {},
    });
    current = undefined;
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const fence = /^(`{3,}|~{3,})([A-Za-z0-9_-]+)\s*$/.exec(line);
    if (fence) {
      if (!current) throw new Error(`${file}:${index + 1}: code fence must belong to a ### test case`);
      const character = fence[1][0];
      const minimum = fence[1].length;
      const body: string[] = [];
      let closed = false;
      while (++index < lines.length) {
        if (new RegExp(`^${character}{${minimum},}\\s*$`).test(lines[index])) {
          closed = true;
          break;
        }
        body.push(lines[index]);
      }
      if (!closed) throw new Error(`${file}: ${current.name}: unclosed ${fence[1]} fence`);
      const language = fence[2].toLowerCase();
      const value = body.join('\n');
      if (inputLanguages.has(language as Dialect)) {
        if (current.input) throw new Error(`${file}: ${current.name}: duplicate input fence`);
        current.input = { language: language as Dialect, value };
      } else if (outputLanguages.has(language as Projection)) {
        if (current.output) throw new Error(`${file}: ${current.name}: duplicate output fence`);
        current.output = { language: language as Projection, value };
      } else if (language === 'json') {
        if (current.options) throw new Error(`${file}: ${current.name}: duplicate json options fence`);
        current.options = parseOptions(value, file, current.name);
      } else throw new Error(`${file}: ${current.name}: unsupported fence language ${language}`);
      continue;
    }
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading?.[1] === '#') {
      if (title) throw new Error(`${file}:${index + 1}: only one # heading is allowed`);
      title = heading[2];
    } else if (heading?.[1] === '##') {
      finish();
      group = heading[2];
      separated = true;
    } else if (heading?.[1] === '###') {
      if (current && !separated) throw new Error(`${file}:${index + 1}: separate cases with ----`);
      finish();
      if (!group) throw new Error(`${file}:${index + 1}: ### case requires a preceding ## group`);
      current = { name: heading[2] };
      separated = false;
    } else if (/^-{4,}\s*$/.test(line)) {
      finish();
      separated = true;
    }
  }
  finish();
  if (!title) throw new Error(`${file}: missing # purpose heading`);
  if (!cases.length) throw new Error(`${file}: no conformance cases`);
  return cases;
}
