import type { View } from '@gneh/core';

export type DOMChildHost = Node & ParentNode;

export interface DOMContext {
  document: Document;
  onError(error: unknown): void;
}

export interface DOMBinding {
  node: Node;
  childrenHost?: DOMChildHost;
  update(view: View, previous?: View): void;
  dispose?(): void;
}

export interface DOMRule {
  id: string;
  match(view: View): boolean;
  shape?(view: View): string;
  mount(view: View, context: DOMContext): DOMBinding;
}

export interface DOMPlugin {
  name?: string;
  rules: readonly DOMRule[];
}

export interface ExtensionMount {
  element: HTMLElement;
  childrenHost?: DOMChildHost;
  update?: (view: View) => void;
  dispose?: () => void;
}

export type ExtensionRenderer = (view: View, document: Document) => ExtensionMount;

export interface DOMOptions {
  onError?: (error: unknown) => void;
  plugins?: readonly DOMPlugin[];
  includeDefaults?: boolean;
  extensions?: Readonly<Record<string, ExtensionRenderer>>;
  unsupported?: 'fallback' | 'error';
}

export interface DOMMount {
  readonly host: HTMLElement;
}
