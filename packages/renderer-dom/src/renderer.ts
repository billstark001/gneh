import { GnehError, type Renderer, type View } from '@gneh/core';

export interface DOMOptions {
  onError?: (error: unknown) => void;
  extensions?: Record<string, ExtensionRenderer>;
  unsupported?: 'fallback' | 'error';
}

export interface ExtensionMount {
  element: HTMLElement;
  childrenHost?: HTMLElement;
  update?: (view: View) => void;
  dispose?: () => void;
}

export type ExtensionRenderer = (view: View, document: Document) => ExtensionMount;

interface RecordNode {
  key: string;
  kind: string;
  node: Node;
  childHost?: HTMLElement;
  children: RecordNode[];
  view: View;
  extension?: ExtensionMount;
}

export interface DOMMount {
  host: HTMLElement;
  records: RecordNode[];
}

export function safeURL(value: unknown, image = false): string {
  if (typeof value !== 'string') return '';
  const s = value.trim();
  // URL schemes can be obfuscated with embedded ASCII whitespace/control bytes.
  // Avoid a control-character regexp so the check remains legible to linters.
  const normalized = [...s]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 0x20 && code !== 0x7f;
    })
    .join('');
  if (!normalized) return '';
  if (image && /^data:image\/(?:png|jpeg|webp|gif);base64,/i.test(normalized)) return s;
  if (/^(?:https?:|mailto:|tel:)/i.test(normalized)) return s;
  if (/^[A-Za-z][\w+.-]*:/.test(normalized) || normalized.startsWith('//') || normalized.startsWith('\\')) return '';
  return s;
}

const tags: Record<string, string> = {
  paragraph: 'p',
  strong: 'strong',
  emphasis: 'em',
  strike: 'del',
  quote: 'blockquote',
  item: 'li',
  code: 'code',
  'code-block': 'pre',
  break: 'br',
  rule: 'hr',
  link: 'a',
  image: 'img',
  span: 'span',
  group: 'div',
  region: 'section',
  choice: 'a',
  button: 'button',
};

/** Keyed DOM backend. No HTML evaluation, arbitrary attributes or global hook selectors. */
export class DOMRenderer implements Renderer<HTMLElement, DOMMount> {
  constructor(private readonly options: DOMOptions = {}) {}
  mount(host: HTMLElement, view: View[]): DOMMount {
    const mount = { host, records: [] as RecordNode[] };
    this.update(mount, view);
    return mount;
  }
  update(mount: DOMMount, view: View[]): void {
    const active = mount.host.ownerDocument.activeElement as HTMLElement | null;
    const owned = active && mount.host.contains(active);
    mount.records = this.patch(mount.host, mount.records, view);
    if (owned && active.isConnected && mount.host.contains(active) && mount.host.ownerDocument.activeElement !== active)
      active.focus({ preventScroll: true });
  }
  dispose(mount: DOMMount): void {
    for (const record of mount.records) this.remove(record);
    mount.records = [];
  }
  private create(view: View, key: string, doc: Document): RecordNode {
    if (view.kind === 'text')
      return {
        key,
        kind: view.kind,
        node: doc.createTextNode(view.text ?? ''),
        children: [],
        view,
      };
    if (view.kind.startsWith('control:')) {
      const control = view.kind.slice(8);
      if (control === 'select') {
        const element = doc.createElement('select');
        let signature = '';
        return {
          key,
          kind: view.kind,
          node: element,
          children: [],
          view,
          extension: {
            element,
            update(next) {
              const options = Array.isArray(next.attrs?.options) ? next.attrs.options : [];
              const nextSignature = JSON.stringify(options);
              if (signature !== nextSignature) {
                signature = nextSignature;
                element.replaceChildren(
                  ...options.map((value) => {
                    const option = doc.createElement('option');
                    option.value = JSON.stringify(value);
                    option.textContent = String(value);
                    return option;
                  }),
                );
              }
              if (Object.hasOwn(next.attrs ?? {}, 'value')) element.value = JSON.stringify(next.attrs?.value);
              element.onchange = () => {
                let value: unknown = element.value;
                try {
                  value = JSON.parse(element.value);
                } catch {}
                next.change?.(value);
              };
            },
          },
        };
      }
      const element = doc.createElement('label');
      const input = doc.createElement('input');
      const label = doc.createElement('span');
      input.type = 'checkbox';
      element.append(input, label);
      return {
        key,
        kind: view.kind,
        node: element,
        childHost: label,
        children: [],
        view,
        extension: {
          element,
          update(next) {
            input.checked = Boolean(next.attrs?.checked);
            input.onchange = () => next.change?.(input.checked);
          },
          dispose: () => (input.onchange = null),
        },
      };
    }
    if (view.kind.startsWith('extension:')) {
      const name = view.kind.slice(10),
        factory = this.options.extensions?.[name];
      if (factory) {
        const ext = factory(view, doc);
        return {
          key,
          kind: view.kind,
          node: ext.element,
          childHost: ext.childrenHost ?? ext.element,
          children: [],
          view,
          extension: ext,
        };
      }
      if (name === 'presentation') {
        const element = doc.createElement('span');
        return {
          key,
          kind: view.kind,
          node: element,
          childHost: element,
          children: [],
          view,
          extension: {
            element,
            childrenHost: element,
            update(next) {
              const property = String(next.attrs?.property ?? '');
              const value = next.attrs?.value;
              const cssValue = Array.isArray(value) ? value.join(' ') : String(value ?? '');
              if (property === 'foreground') element.style.color = String(value ?? '');
              else if (property === 'font-family') element.style.fontFamily = cssValue;
              else if (property === 'scale') {
                const scale = Number(value);
                element.style.fontSize = Number.isFinite(scale) ? `${scale * 100}%` : '';
              } else if (property === 'border-style') element.style.borderStyle = cssValue;
              else if (property === 'border-color') element.style.borderColor = cssValue;
              else if (property === 'corner-radius') element.style.borderRadius = cssValue;
              else if (property === 'text-style') {
                const style = String(value ?? '').toLowerCase();
                element.style.fontWeight = style.includes('bold') ? 'bold' : '';
                element.style.fontStyle = style.includes('italic') ? 'italic' : '';
                element.style.textDecoration = style.includes('underline')
                  ? 'underline'
                  : style.includes('strike')
                    ? 'line-through'
                    : '';
                element.dataset.style = style;
              }
            },
          },
        };
      }
      if (
        this.options.unsupported === 'error' &&
        !['box', 'dialogue', 'scene', 'note', 'choice-group', 'status'].includes(name)
      )
        throw new GnehError('PRESENTATION_UNSUPPORTED', `No DOM presenter registered for ${name}`);
      const element = doc.createElement('section');
      element.dataset.extension = name;
      if (name === 'dialogue') {
        const speaker = doc.createElement('strong');
        speaker.className = 'gneh-speaker';
        element.append(speaker);
        const content = doc.createElement('div');
        element.append(content);
        return {
          key,
          kind: view.kind,
          node: element,
          childHost: content,
          children: [],
          view,
          extension: {
            element,
            childrenHost: content,
            update(v) {
              speaker.textContent = typeof v.attrs?.speaker === 'string' ? v.attrs.speaker : '';
            },
          },
        };
      }
      return { key, kind: view.kind, node: element, childHost: element, children: [], view };
    }
    const tag =
      view.kind === 'heading'
        ? 'h' + Math.max(1, Math.min(6, Number(view.attrs?.level) || 1))
        : view.kind === 'list'
          ? view.attrs?.ordered
            ? 'ol'
            : 'ul'
          : (tags[view.kind] ?? 'div');
    const element = doc.createElement(tag);
    return { key, kind: view.kind, node: element, childHost: element, children: [], view };
  }
  private patch(host: HTMLElement, old: RecordNode[], views: View[]): RecordNode[] {
    const available = new Map(old.map((r) => [r.key, r]));
    const next: RecordNode[] = [];
    const seen = new Set<string>();
    let cursor: ChildNode | null = host.firstChild;
    for (let i = 0; i < views.length; i++) {
      const view = views[i],
        key = view.key ?? `@${i}`;
      if (seen.has(key)) throw new GnehError('DOM_DUPLICATE_KEY', `Duplicate view key ${key}`);
      seen.add(key);
      let record = available.get(key);
      if (record && record.kind !== view.kind) {
        this.remove(record);
        available.delete(key);
        record = undefined;
        cursor = host.firstChild;
      }
      if (!record) record = this.create(view, key, host.ownerDocument);
      else available.delete(key);
      record.view = view;
      if (view.kind === 'text') record.node.textContent = view.text ?? '';
      else {
        const element = record.node as HTMLElement;
        const attrs = view.attrs ?? {};
        const tokens = Array.isArray(attrs.tokens)
          ? (attrs.tokens.filter((t) => typeof t === 'string' && /^[\w-]+$/.test(t)) as string[])
          : [];
        element.className = `gneh-${view.kind.replaceAll(':', '-')}`;
        element.dataset.tokens = tokens.join(' ');
        if (typeof attrs.id === 'string') element.dataset.ref = attrs.id;
        else delete element.dataset.ref;
        if (view.kind === 'region') element.dataset.region = String(attrs.name ?? '');
        if (view.kind === 'choice' || view.kind === 'button') {
          if (view.kind === 'button') (element as HTMLButtonElement).type = 'button';
          else (element as HTMLAnchorElement).href = '#' + encodeURIComponent(String(attrs.target ?? ''));
          element.onclick = (event) => {
            event.preventDefault();
            try {
              record!.view.activate?.();
            } catch (error) {
              if (this.options.onError) this.options.onError(error);
              else throw error;
            }
          };
        }
        if (view.kind === 'link') {
          const url = safeURL(attrs.href);
          if (url) element.setAttribute('href', url);
          else element.removeAttribute('href');
          element.setAttribute('rel', 'noopener noreferrer');
        }
        if (view.kind === 'image') {
          const src = safeURL(attrs.src, true);
          if (src) element.setAttribute('src', src);
          else element.removeAttribute('src');
          element.setAttribute('alt', String(attrs.alt ?? ''));
          element.setAttribute('loading', 'lazy');
        }
        record.extension?.update?.(view);
        const children = view.text !== undefined ? [{ kind: 'text' as const, text: view.text }] : (view.children ?? []);
        if (record.childHost) record.children = this.patch(record.childHost, record.children, children);
      }
      if (record.node !== cursor) host.insertBefore(record.node, cursor);
      cursor = record.node.nextSibling;
      next.push(record);
    }
    for (const record of available.values()) this.remove(record);
    return next;
  }
  private remove(record: RecordNode): void {
    for (const child of record.children) this.remove(child);
    record.extension?.dispose?.();
    if (record.node instanceof record.node.ownerDocument!.defaultView!.HTMLElement)
      (record.node as HTMLElement).onclick = null;
    if (record.node instanceof record.node.ownerDocument!.defaultView!.HTMLElement) {
      const element = record.node as HTMLElement;
      element.onchange = null;
    }
    record.node.parentNode?.removeChild(record.node);
  }
}

export const createDOMRenderer = (options?: DOMOptions): DOMRenderer => new DOMRenderer(options);
