import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { Dialect, Metadata } from '@gneh/core';

type Element = DefaultTreeAdapterTypes.Element;

type Node = DefaultTreeAdapterTypes.Node;

export type TwineAttribute = string | true;

export interface TwinePassageData {
  name: string;
  tags: string[];
  source: string;
  /** Exact encoded text between the tw-passagedata tags. */
  encodedSource: string;
  /** Exact text inside the opening tag, useful for attributes unknown to gneh. */
  attributeSource: string;
  attributes: Record<string, TwineAttribute>;
}

export interface TwineEmbeddedData {
  source: string;
  encodedSource: string;
  attributeSource: string;
  attributes: Record<string, TwineAttribute>;
}

export interface TwineTagDefinition {
  attributeSource: string;
  attributes: Record<string, TwineAttribute>;
}

export interface TwineStoryData {
  format: string;
  formatVersion: string;
  attributeSource: string;
  attributes: Record<string, TwineAttribute>;
  passages: TwinePassageData[];
  stylesheets: TwineEmbeddedData[];
  scripts: TwineEmbeddedData[];
  tagDefinitions: TwineTagDefinition[];
}

function elements(root: Node, tagName: string): Element[] {
  const found: Element[] = [];
  const visit = (node: Node): void => {
    if ('tagName' in node && node.tagName === tagName) found.push(node);
    if ('childNodes' in node) node.childNodes.forEach(visit);
    if ('content' in node) visit(node.content);
  };
  visit(root);
  return found;
}

function attributes(element: Element, html: string): Record<string, TwineAttribute> {
  const result: Record<string, TwineAttribute> = Object.create(null);
  const locations = element.sourceCodeLocation?.attrs;
  for (const attribute of element.attrs) {
    const location = locations?.[attribute.name];
    const authored = location ? html.slice(location.startOffset, location.endOffset) : '';
    result[attribute.name] = authored && !authored.includes('=') ? true : attribute.value;
  }
  return result;
}

function attributeSource(element: Element, html: string): string {
  const location = element.sourceCodeLocation?.startTag;
  if (!location) return '';
  const tag = html.slice(location.startOffset, location.endOffset);
  return tag.slice(1 + element.tagName.length, -1);
}

function encodedContent(element: Element, html: string): string {
  const location = element.sourceCodeLocation;
  const start = location?.startTag?.endOffset;
  const end = location?.endTag?.startOffset ?? location?.endOffset;
  return start === undefined || end === undefined ? '' : html.slice(start, end);
}

function textContent(node: Node): string {
  if ('value' in node) return node.value;
  if ('content' in node) return textContent(node.content);
  return 'childNodes' in node ? node.childNodes.map(textContent).join('') : '';
}

function embedded(element: Element, html: string): TwineEmbeddedData {
  return {
    source: textContent(element),
    encodedSource: encodedContent(element, html),
    attributeSource: attributeSource(element, html),
    attributes: attributes(element, html),
  };
}

/** Extract Twine's published data elements for the CLI without executing the document. */
export function parseTwineHTML(html: string): TwineStoryData {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const story = elements(document, 'tw-storydata')[0];
  if (!story) throw new Error('No <tw-storydata> element found.');
  const storyAttributes = attributes(story, html);
  const passages = elements(story, 'tw-passagedata').map((element, index): TwinePassageData => {
    const passageAttributes = attributes(element, html);
    const name = passageAttributes.name;
    const tags = passageAttributes.tags;
    return {
      name: typeof name === 'string' && name ? name : `passage-${index + 1}`,
      tags: typeof tags === 'string' ? tags.split(/\s+/).filter(Boolean) : [],
      source: textContent(element),
      encodedSource: encodedContent(element, html),
      attributeSource: attributeSource(element, html),
      attributes: passageAttributes,
    };
  });
  const stylesheets = elements(story, 'style')
    .filter((element) => attributes(element, html).role === 'stylesheet')
    .map((element) => embedded(element, html));
  const scripts = elements(story, 'script')
    .filter((element) => attributes(element, html).role === 'script')
    .map((element) => embedded(element, html));
  return {
    format: typeof storyAttributes.format === 'string' ? storyAttributes.format : '',
    formatVersion: typeof storyAttributes['format-version'] === 'string' ? storyAttributes['format-version'] : '',
    attributeSource: attributeSource(story, html),
    attributes: storyAttributes,
    passages,
    stylesheets,
    scripts,
    tagDefinitions: elements(story, 'tw-tag').map((element) => ({
      attributeSource: attributeSource(element, html),
      attributes: attributes(element, html),
    })),
  };
}

export function twineDialect(story: TwineStoryData): Dialect | undefined {
  const format = story.format.toLowerCase();
  return format === 'harlowe' ? 'karlowe' : format === 'sugarcube' ? 'sugarcast' : undefined;
}

function escapeHeaderName(value: string): string {
  return [...value].map((character) => ('[]{}\\'.includes(character) ? '\\' + character : character)).join('');
}

/** Emit one Twee 3 file while retaining every Twine passage attribute as metadata. */
export function emitTwineTwee(story: TwineStoryData): string {
  return story.passages
    .map((passage) => {
      const metadata: Metadata = { twine: passage.attributes };
      const tags = passage.tags.length ? ` [${passage.tags.join(' ')}]` : '';
      const body = passage.source.endsWith('\n') ? passage.source : passage.source + '\n';
      return `:: ${escapeHeaderName(passage.name)}${tags} ${JSON.stringify(metadata)}\n${body}`;
    })
    .join('\n');
}

export function twineEntry(story: TwineStoryData): string | undefined {
  const start = story.attributes.startnode;
  if (typeof start === 'string') {
    const passage = story.passages.find((item) => item.attributes.pid === start);
    if (passage) return passage.name;
  }
  return story.passages[0]?.name;
}
