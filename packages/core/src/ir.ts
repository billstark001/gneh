import type { Diagnostic, Span } from './errors.js';
import type { Json, State } from './json.js';
import type { BindingPattern, ExpressionNode } from 'pure-expr/expr';

export const ABI_VERSION = 1 as const;

export interface Expression {
  ast: ExpressionNode;
  source: string;
  span: Span;
}

export type EffectNode =
  | { type: 'expression'; expression: ExpressionNode }
  | { type: 'bind'; binding: BindingPattern; value: ExpressionNode }
  | { type: 'if'; test: ExpressionNode; yes: EffectNode[]; no: EffectNode[] }
  | { type: 'each'; binding: BindingPattern; items: ExpressionNode; body: EffectNode[] }
  | { type: 'invoke'; name: string; args: ExpressionNode[] };

export interface EffectDeclarationIR {
  phase: 'effect';
  name: string;
  params: BindingPattern[];
  body: EffectNode[];
  source: string;
  span: Span;
}

export interface ViewDeclarationIR {
  phase: 'view';
  name: string;
  params: BindingPattern[];
  body: StoryNode[];
  source: string;
  span: Span;
}

export interface ImportIR {
  source: string;
  imported: string;
  local: string;
}

export interface EffectCallIR {
  name: string;
  args: ExpressionNode[];
}

export type Dialect = 'inkdown' | 'karlowe' | 'sugarcast';

export type Metadata = Record<string, Json>;

export type ContentKind =
  | 'paragraph'
  | 'heading'
  | 'bold'
  | 'italic'
  | 'strong'
  | 'emphasis'
  | 'underline'
  | 'strike'
  | 'superscript'
  | 'subscript'
  | 'quote'
  | 'list'
  | 'item'
  | 'code'
  | 'code-block'
  | 'break'
  | 'rule'
  | 'link'
  | 'image'
  | 'span'
  | 'group';

export type StoryNode =
  | { type: 'text'; value: string; span: Span }
  | { type: 'content'; kind: ContentKind; attrs: Metadata; children: StoryNode[]; span: Span }
  | { type: 'effect'; effects: EffectNode[]; span: Span }
  | { type: 'value'; expression: Expression; span: Span }
  | { type: 'if'; test: Expression; yes: StoryNode[]; no: StoryNode[]; span: Span }
  | {
      type: 'each';
      name: string;
      items: Expression;
      key?: Expression;
      children: StoryNode[];
      span: Span;
    }
  | { type: 'include'; target: string; props?: Expression; span: Span }
  | { type: 'choice'; target: string; props?: Expression; children: StoryNode[]; span: Span }
  | { type: 'button'; action: EffectCallIR; children: StoryNode[]; span: Span }
  | { type: 'view-call'; name: string; args: Expression[]; children: StoryNode[]; span: Span }
  | { type: 'children'; span: Span }
  | {
      type: 'interaction';
      behavior: 'reveal' | 'repeat';
      label: StoryNode[];
      children: StoryNode[];
      span: Span;
    }
  | { type: 'region'; name: string; children: StoryNode[]; span: Span }
  | {
      type: 'region-change';
      name: string;
      mode: 'replace' | 'append' | 'prepend';
      children: StoryNode[];
      span: Span;
    }
  | {
      type: 'portal';
      name: string;
      mode: 'replace' | 'append' | 'prepend';
      children: StoryNode[];
      span: Span;
    }
  | {
      type: 'control';
      control: 'select' | 'checkbox';
      action: EffectCallIR;
      value: Expression;
      options: Expression[];
      label: StoryNode[];
      span: Span;
    }
  | {
      type: 'extension';
      name: string;
      attrs: Metadata;
      bindings: Record<string, Expression>;
      children: StoryNode[];
      span: Span;
    }
  | {
      /** Renderer-neutral call into an application-provided runtime extension. */
      type: 'invoke';
      id: string;
      phase: 'view' | 'effect';
      args: Expression[];
      children: StoryNode[];
      span: Span;
    };

export interface PassageIR {
  id: string;
  name: string;
  dialect: Dialect;
  metadata: Metadata;
  source: string;
  span: Span;
  body: StoryNode[];
  /** Reactive documents recompute from state; materialized documents memoize source-order evaluation per mount. */
  evaluation: 'reactive' | 'materialized';
  enter: EffectNode[];
  effects: Record<string, EffectDeclarationIR>;
  views: Record<string, ViewDeclarationIR>;
  constants: Record<string, Expression>;
  imports: ImportIR[];
  exports: string[];
  capabilities: string[];
}

export interface StoryIR {
  abi: typeof ABI_VERSION;
  entry: string;
  state: State;
  metadata: Metadata;
  passages: PassageIR[];
}

export interface ParsedPassage {
  id: string;
  name: string;
  body: string;
  metadata: Metadata;
  span: Span;
  bodyOffset: number;
}

export interface ParseResult {
  passages: PassageIR[];
  diagnostics: Diagnostic[];
}

export interface CompileResult extends ParseResult {
  story: StoryIR;
}
