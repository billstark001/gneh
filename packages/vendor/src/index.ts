import { GnehError, type Dialect, type Fragment, type Metadata, type State, type StoryIR } from '@gneh/core';
import {
  compileProject,
  parseSource,
  assertValid,
  walkNodes,
  type DialectLowerings,
  type SourceInput,
} from '@gneh/compiler';
import { defineIRFragment } from '@gneh/runtime';
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
    lowerings?: DialectLowerings;
    runtimeExtensionIds?: readonly string[];
  } = {},
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
    lowerings: options.lowerings,
    runtimeExtensionIds: options.runtimeExtensionIds,
  });
  assertValid(result);
  return result.story;
}

export function createWikifier(
  options: {
    dialect?: Dialect;
    pure?: boolean;
    lowerings?: DialectLowerings;
  } = {},
): (source: string, dialect?: Dialect) => Fragment {
  let counter = 0;
  return (source, dialect = options.dialect ?? 'inkdown') => {
    const id = `wikify_${++counter}`;
    const parsed = parseSource(source, `${id}.${dialect}`, dialect, {
      lowerings: options.lowerings,
    });
    assertValid(parsed);
    if (parsed.passages.length !== 1)
      throw new GnehError('WIKIFY_FRAGMENT', 'wikify accepts one fragment, not a multi-passage file.');
    const p = parsed.passages[0];
    let sourceEffect = false;
    walkNodes(p.body, (node) => {
      if (node.type === 'effect' || node.type === 'region-change' || node.type === 'portal') sourceEffect = true;
    });
    if (p.imports.length || p.enter.length || sourceEffect)
      throw new GnehError('WIKIFY_EFFECT', 'wikify does not accept ESM imports or source effects.');
    if (options.pure && (Object.keys(p.effects).length || p.capabilities.includes('live')))
      throw new GnehError('WIKIFY_PURE', 'wikifyPure excludes actions and mutable regions.');
    return defineIRFragment({ ...p, id, metadata: { ...p.metadata, id } });
  };
}

export function startVendor(
  host: HTMLElement,
  data: VendorData | StoryIR,
  options: DOMStoryOptions & {
    wikifyEnabled?: boolean;
    lowerings?: DialectLowerings;
  } = {},
): DOMStoryMount {
  const { wikifyEnabled, lowerings, ...storyOptions } = options;
  const runtimeExtensionIds = Object.keys(options.runtimeExtensions ?? {});
  const story = 'abi' in data ? data : readPassageData(data, { lowerings, runtimeExtensionIds });
  return mountStory(host, story, {
    ...storyOptions,
    wikify: wikifyEnabled ? createWikifier({ lowerings }) : undefined,
  });
}
