import { GnehError, type Dialect, type Fragment, type Metadata, type State, type StoryIR } from '@gneh/core';
import {
  compileProject,
  parseSource,
  assertValid,
  walkNodes,
  type DialectFrontend,
  type SourceInput,
} from '@gneh/compiler';
import { defineIRFragment } from '@gneh/runtime/compiler';
import { mountStory, type DOMStoryMount, type DOMStoryOptions } from '@gneh/renderer-dom';

export * from '@gneh/core';

export * from '@gneh/runtime';

export * from '@gneh/renderer-dom';

export { compileProject, parseSource } from '@gneh/compiler';

export interface PassageData {
  id: string;
  name?: string;
  dialect: Dialect;
  text: string;
  metadata?: Metadata;
}

export interface VendorData {
  entry: string;
  state?: State;
  passages: PassageData[];
  metadata?: Metadata;
}

export function readPassageData(
  data: VendorData,
  options: {
    dialects: readonly DialectFrontend[];
    runtimeExtensionIds?: readonly string[];
  },
): StoryIR {
  const sources: SourceInput[] = data.passages.map((p, i) => ({
    path: `passage-${i}.${p.dialect}`,
    dialect: p.dialect,
    source: `:: ${p.name ?? p.id} ${JSON.stringify({ ...p.metadata, id: p.id })}\n${p.text}`,
  }));
  const result = compileProject(sources, {
    entry: data.entry,
    state: data.state,
    metadata: data.metadata,
    mode: 'vendor',
    runtimeExtensionIds: options.runtimeExtensionIds,
    dialects: options.dialects,
  });
  assertValid(result);
  return result.story;
}

export function createWikifier(options: {
  dialects: readonly DialectFrontend[];
  dialect?: Dialect;
  pure?: boolean;
}): (source: string, dialect?: Dialect) => Fragment {
  let counter = 0;
  return (source, dialect = options.dialect ?? 'inkdown') => {
    const id = `wikify_${++counter}`;
    const parsed = parseSource(`:: ${id}\n${source}`, `${id}.${dialect}`, dialect, { dialects: options.dialects });
    assertValid(parsed);
    if (parsed.passages.length !== 1)
      throw new GnehError('WIKIFY_FRAGMENT', 'wikify accepts one fragment, not a multi-passage file.');
    const p = parsed.passages[0];
    let sourceEffect = false;
    walkNodes(p.body, (node) => {
      if (node.type === 'effect' || node.type === 'region-change' || node.type === 'portal') sourceEffect = true;
    });
    if ((parsed.module?.imports.length ?? 0) || sourceEffect)
      throw new GnehError('WIKIFY_EFFECT', 'wikify does not accept ESM imports or source effects.');
    let callableEffect = false;
    walkNodes(p.body, (node) => {
      if (node.type === 'callable' && node.callable.phase === 'effect') callableEffect = true;
    });
    if (options.pure && (callableEffect || p.capabilities.includes('live')))
      throw new GnehError('WIKIFY_PURE', 'wikifyPure excludes actions and mutable regions.');
    return defineIRFragment({ ...p, id, metadata: { ...p.metadata, id } });
  };
}

export function startVendor(
  host: HTMLElement,
  data: VendorData | StoryIR,
  options: DOMStoryOptions & {
    dialects: readonly DialectFrontend[];
    wikifyEnabled?: boolean;
  },
): DOMStoryMount {
  const { wikifyEnabled, dialects, ...storyOptions } = options;
  const runtimeExtensionIds = Object.keys(options.runtimeExtensions ?? {});
  const story = 'abi' in data ? data : readPassageData(data, { dialects, runtimeExtensionIds });
  return mountStory(host, story, {
    ...storyOptions,
    wikify: wikifyEnabled ? createWikifier({ dialects }) : undefined,
  });
}
