import type { Diagnostic, Span } from './errors.js';
import type { Json, State } from './json.js';
import type { BindingPattern, ExpressionNode } from 'pure-expr/expr';

export const ABI_VERSION = 1 as const;

export interface Expression {
  ast: ExpressionNode;
  source: string;
  span: Span;
}

export type InvocationPhase = 'view' | 'effect';

export type CallablePhase = InvocationPhase | 'value';

export interface ValueCallableBodyIR {
  effects: EffectNode[];
  result: Expression;
}

export interface CallableIR {
  id: string;
  phase: CallablePhase;
  capture: 'lexical' | 'story';
  name?: string;
  params: BindingPattern[];
  body: StoryNode[] | EffectNode[] | ValueCallableBodyIR;
  source: string;
  span: Span;
  /** Unbounded declarations escape only after their source-order declaration runs. */
  escape?: 'publish' | 'export';
}

export type CallableCalleeIR =
  | { type: 'binding'; name: string }
  | { type: 'expression'; expression: Expression }
  | { type: 'inline'; callable: CallableIR };

export interface CallableCallIR {
  callee: CallableCalleeIR;
  args: Expression[];
}

export type EffectNode =
  | { type: 'expression'; expression: ExpressionNode }
  | { type: 'bind'; binding: BindingPattern; value: ExpressionNode; mutable?: boolean }
  | { type: 'if'; test: ExpressionNode; yes: EffectNode[]; no: EffectNode[] }
  | { type: 'each'; binding: BindingPattern; items: ExpressionNode; body: EffectNode[] }
  | {
      type: 'assign-callable';
      target: Extract<ExpressionNode, { type: 'Identifier' | 'MemberExpression' }>;
      callable: CallableIR;
    }
  | { type: 'publish-callable'; name: string; callable: CallableIR }
  | { type: 'call'; call: CallableCallIR };

export interface ImportIR {
  source: string;
  imported: string;
  local: string;
}

export type Dialect = 'inkdown' | 'karlowe' | 'sugarcast';

export type Metadata = Record<string, Json>;

/** Serializable suspension descriptions. Expressions are resolved when reached. */
export type ResumeConditionIR =
  | { type: 'manual' }
  | { type: 'timer'; durationMs: Expression; clock?: 'active' | 'wall' }
  | { type: 'signal'; name: string; filter?: Expression }
  | { type: 'task'; operation: string; args: Expression[] };

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
  | { type: 'suspend'; id?: string; resume: ResumeConditionIR; bind?: BindingPattern; span: Span }
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
  | { type: 'button'; action: CallableCallIR; children: StoryNode[]; span: Span }
  | { type: 'call'; call: CallableCallIR; children: StoryNode[]; span: Span }
  | { type: 'callable'; callable: CallableIR; span: Span }
  | { type: 'publish'; names: string[] | '*'; span: Span }
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
      action: CallableCallIR;
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
      phase: InvocationPhase;
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
  constants: Record<string, Expression>;
  capabilities: string[];
}

export interface StoryIR {
  abi: typeof ABI_VERSION;
  entry: string;
  state: State;
  metadata: Metadata;
  passages: PassageIR[];
  setup?: string[];
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
  module?: SourceModuleIR;
}

export interface ExportIR {
  local: string;
  exported: string;
}

/** File-level linkage and initialization. The primary initializer is never a route. */
export interface SourceModuleIR {
  metadata: Metadata;
  imports: ImportIR[];
  exports: ExportIR[];
  setup: string[];
  primary?: PassageIR;
}

export interface CompileResult extends ParseResult {
  story: StoryIR;
}
