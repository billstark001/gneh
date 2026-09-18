import { GnehError, type Renderer, type View } from '@gneh/core';
import { extensionRenderersPlugin } from './plugins/extensions.js';
import { defaultDOMPlugins } from './plugins/default.js';
import { DOMRuleRegistry } from './registry.js';
import type { DOMBinding, DOMChildHost, DOMMount, DOMOptions } from './types.js';

interface RecordNode {
  key: string;
  ruleId: string;
  shape: string;
  binding: DOMBinding;
  children: RecordNode[];
  view: View;
}

interface MountState {
  records: RecordNode[];
}

export class DOMRenderer implements Renderer<HTMLElement, DOMMount> {
  private readonly registry: DOMRuleRegistry;
  private readonly mounts = new WeakMap<DOMMount, MountState>();
  private readonly onError: (error: unknown) => void;

  constructor(options: DOMOptions = {}) {
    const plugins = [
      ...(options.includeDefaults === false ? [] : defaultDOMPlugins({ unsupported: options.unsupported })),
      ...(options.extensions ? [extensionRenderersPlugin(options.extensions)] : []),
      ...(options.plugins ?? []),
    ];

    this.registry = new DOMRuleRegistry(plugins);
    this.onError =
      options.onError ??
      ((error) => {
        throw error;
      });
  }

  mount(host: HTMLElement, view: View[]): DOMMount {
    const mount: DOMMount = { host };
    this.mounts.set(mount, { records: [] });
    this.update(mount, view);
    return mount;
  }

  update(mount: DOMMount, view: View[]): void {
    const state = this.mounts.get(mount);
    if (!state) throw new GnehError('DOM_INVALID_MOUNT', 'DOM mount is not active');

    const document = mount.host.ownerDocument;
    const active = document.activeElement as HTMLElement | null;
    const owned = Boolean(active && mount.host.contains(active));

    state.records = this.patch(mount.host, state.records, view);

    if (owned && active?.isConnected && mount.host.contains(active) && document.activeElement !== active) {
      active.focus({ preventScroll: true });
    }
  }

  dispose(mount: DOMMount): void {
    const state = this.mounts.get(mount);
    if (!state) return;

    for (const record of state.records) this.remove(record);
    state.records = [];
    this.mounts.delete(mount);
  }

  private patch(host: DOMChildHost, old: RecordNode[], views: View[]): RecordNode[] {
    const available = new Map(old.map((record) => [record.key, record]));
    const next: RecordNode[] = [];
    const seen = new Set<string>();
    let cursor: ChildNode | null = host.firstChild;

    for (let index = 0; index < views.length; index++) {
      const view = views[index];
      const key = view.key ?? `@${index}`;

      if (seen.has(key)) throw new GnehError('DOM_DUPLICATE_KEY', `Duplicate view key ${key}`);
      seen.add(key);

      const rule = this.registry.resolve(view);
      const shape = rule.shape?.(view) ?? view.kind;
      let record = available.get(key);

      if (record && (record.ruleId !== rule.id || record.shape !== shape)) {
        if (record.binding.node === cursor) cursor = cursor.nextSibling;
        this.remove(record);
        available.delete(key);
        record = undefined;
      }

      const previous = record?.view;

      if (!record) {
        const context = {
          document: host.ownerDocument!,
          onError: this.onError,
        };
        const binding = rule.mount(view, context);
        record = { key, ruleId: rule.id, shape, binding, children: [], view };
      } else {
        available.delete(key);
      }

      record.view = view;
      record.binding.update(view, previous);

      if (record.binding.childrenHost) {
        const children = view.text !== undefined ? [{ kind: 'text' as const, text: view.text }] : (view.children ?? []);
        record.children = this.patch(record.binding.childrenHost, record.children, children);
      } else if (record.children.length > 0) {
        for (const child of record.children) this.remove(child);
        record.children = [];
      }

      if (record.binding.node !== cursor) host.insertBefore(record.binding.node, cursor);
      cursor = record.binding.node.nextSibling;
      next.push(record);
    }

    for (const record of available.values()) this.remove(record);
    return next;
  }

  private remove(record: RecordNode): void {
    for (const child of record.children) this.remove(child);
    record.binding.dispose?.();
    record.binding.node.parentNode?.removeChild(record.binding.node);
  }
}

export const createDOMRenderer = (options?: DOMOptions): DOMRenderer => new DOMRenderer(options);
