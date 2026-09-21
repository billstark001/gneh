import { GnehError, type View } from '@gneh/core';

type Callback = { type: 'activate'; invoke: () => void } | { type: 'change'; invoke: (value: unknown) => void };

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function json(value: unknown, seen = new Set<object>()): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new GnehError('XML_ATTRIBUTE', 'XML attributes cannot contain non-finite numbers.');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object')
    throw new GnehError('XML_ATTRIBUTE', `Unsupported XML attribute value: ${typeof value}`);
  if (seen.has(value)) throw new GnehError('XML_ATTRIBUTE', 'XML attributes cannot contain cycles.');
  seen.add(value);
  let output: string;
  if (Array.isArray(value)) output = `[${value.map((item) => json(item, seen)).join(',')}]`;
  else {
    const object = value as Record<string, unknown>;
    output = `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${json(object[key], seen)}`)
      .join(',')}}`;
  }
  seen.delete(value);
  return output;
}

function elementName(kind: string): { name: string; intrinsic: Record<string, unknown> } {
  if (kind.startsWith('extension:')) return { name: 'extension', intrinsic: { name: kind.slice(10) } };
  if (kind.startsWith('control:')) return { name: 'control', intrinsic: { type: kind.slice(8) } };
  if (!/^[A-Za-z_][\w.-]*$/.test(kind)) throw new GnehError('XML_NODE', `Invalid structural node kind: ${kind}`);
  return { name: kind, intrinsic: {} };
}

/** Stateful callback harness paired with a deterministic structural serialization. */
export class XMLRenderer {
  private callbacks = new Map<string, Callback>();
  private nextCallbacks = new Map<string, Callback>();

  render(view: readonly View[]): string {
    this.nextCallbacks = new Map();
    const body = view.map((node, index) => this.node(node, `/${index}`)).join('');
    this.callbacks = this.nextCallbacks;
    return `<gneh>${body}</gneh>`;
  }

  activate(handle: string): void {
    const callback = this.callbacks.get(handle);
    if (!callback || callback.type !== 'activate')
      throw new GnehError('XML_HANDLE', `Unknown activation handle: ${handle}`);
    callback.invoke();
  }

  change(handle: string, value: unknown): void {
    const callback = this.callbacks.get(handle);
    if (!callback || callback.type !== 'change') throw new GnehError('XML_HANDLE', `Unknown change handle: ${handle}`);
    callback.invoke(value);
  }

  handles(): readonly string[] {
    return [...this.callbacks.keys()].sort();
  }

  private node(view: View, path: string): string {
    const { name, intrinsic } = elementName(view.kind);
    const identity = view.key ?? path;
    const attributes: Record<string, unknown> = { ...view.attrs, ...intrinsic };
    if (view.key !== undefined) attributes.key = view.key;
    if (view.activate) {
      const handle = `activate:${identity}`;
      if (this.nextCallbacks.has(handle)) throw new GnehError('XML_HANDLE', `Duplicate callback handle: ${handle}`);
      attributes.activate = handle;
      this.nextCallbacks.set(handle, { type: 'activate', invoke: view.activate });
    }
    if (view.change) {
      const handle = `change:${identity}`;
      if (this.nextCallbacks.has(handle)) throw new GnehError('XML_HANDLE', `Duplicate callback handle: ${handle}`);
      attributes.change = handle;
      this.nextCallbacks.set(handle, { type: 'change', invoke: view.change });
    }
    const serialized = Object.keys(attributes)
      .sort()
      .map((key) => ` ${key}="${escape(json(attributes[key]))}"`)
      .join('');
    const content = `${view.text === undefined ? '' : escape(view.text)}${(view.children ?? [])
      .map((child, index) => this.node(child, `${path}/${index}`))
      .join('')}`;
    return `<${name}${serialized}>${content}</${name}>`;
  }
}

export function renderXML(view: readonly View[]): string {
  return new XMLRenderer().render(view);
}

export function renderText(view: readonly View[]): string {
  return view.map((node) => `${node.text ?? ''}${renderText(node.children ?? [])}`).join('');
}
