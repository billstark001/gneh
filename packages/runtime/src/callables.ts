import {
  bindParameters,
  bindingOwner,
  evaluateExpression,
  executeEffects,
  invariant,
  lexicalScope,
  type CallableCallIR,
  type CallableIR,
  type EffectCallableRuntime,
  type EffectNode,
  type Expression,
  type FragmentContext,
  type PassageIR,
  type Scope,
  type StoryNode,
  type ValueCallableBodyIR,
} from '@gneh/core';
import { deepReadonly } from './readonly.js';
import { isAuthoredCallable, type AuthoredCallable } from './definition.js';

const maxIRDepth = 128;
const maxCallDepth = 128;

interface RuntimeCallable {
  readonly kind: 'gneh.callable';
  readonly phase: CallableIR['phase'];
  readonly declaration: CallableIR;
  readonly environment: Scope;
}

interface SerializedCallable {
  readonly kind: 'gneh.callable-ref';
  readonly declaration: string;
}

export interface ChildrenInvocation {
  readonly body: StoryNode[];
  readonly environment: Scope;
  readonly path: string;
}

const isCallable = (value: unknown): value is RuntimeCallable =>
  !!value && typeof value === 'object' && (value as RuntimeCallable).kind === 'gneh.callable';
const isSerializedCallable = (value: unknown): value is SerializedCallable =>
  !!value && typeof value === 'object' && (value as SerializedCallable).kind === 'gneh.callable-ref';

/** Owns declaration lookup and the explicit parent-linked environments captured by authored callables. */
export class CallableRuntime implements EffectCallableRuntime {
  private readonly declarations = new Map<string, CallableIR>();
  private callDepth = 0;

  constructor(ir: PassageIR) {
    this.collectNodes(ir.body, 0);
  }

  private collectCallable(callable: CallableIR, depth: number): void {
    invariant(depth < maxIRDepth, 'IR_DEPTH', 'Maximum runtime IR nesting exceeded.');
    this.declarations.set(callable.id, callable);
    if (callable.phase === 'view') this.collectNodes(callable.body as StoryNode[], depth);
    else if (callable.phase === 'effect') this.collectEffects(callable.body as EffectNode[], depth);
    else this.collectEffects((callable.body as ValueCallableBodyIR).effects, depth);
  }

  private collectEffects(effects: EffectNode[], depth: number): void {
    invariant(depth < maxIRDepth, 'IR_DEPTH', 'Maximum runtime IR nesting exceeded.');
    for (const effect of effects) {
      if (effect.type === 'assign-callable' || effect.type === 'publish-callable')
        this.collectCallable(effect.callable, depth + 1);
      else if (effect.type === 'call' && effect.call.callee.type === 'inline')
        this.collectCallable(effect.call.callee.callable, depth + 1);
      else if (effect.type === 'if') {
        this.collectEffects(effect.yes, depth + 1);
        this.collectEffects(effect.no, depth + 1);
      } else if (effect.type === 'each') this.collectEffects(effect.body, depth + 1);
    }
  }

  private collectNodes(nodes: StoryNode[], depth: number): void {
    invariant(depth < maxIRDepth, 'IR_DEPTH', 'Maximum runtime IR nesting exceeded.');
    for (const node of nodes) {
      if (node.type === 'callable') this.collectCallable(node.callable, depth + 1);
      if (node.type === 'if') {
        this.collectNodes(node.yes, depth + 1);
        this.collectNodes(node.no, depth + 1);
      } else if ('children' in node) this.collectNodes(node.children, depth + 1);
      if (node.type === 'effect') this.collectEffects(node.effects, depth + 1);
      if ((node.type === 'button' || node.type === 'control') && node.action.callee.type === 'inline')
        this.collectCallable(node.action.callee.callable, depth + 1);
      if (node.type === 'call' && node.call.callee.type === 'inline')
        this.collectCallable(node.call.callee.callable, depth + 1);
    }
  }

  private instantiate(declaration: CallableIR, environment: Scope): RuntimeCallable {
    return Object.freeze({ kind: 'gneh.callable', phase: declaration.phase, declaration, environment });
  }

  callableValue(declaration: CallableIR, environment: Scope): RuntimeCallable | SerializedCallable {
    this.declarations.set(declaration.id, declaration);
    return declaration.capture === 'story'
      ? Object.freeze({ kind: 'gneh.callable-ref', declaration: declaration.id })
      : this.instantiate(declaration, environment);
  }

  resolve(value: unknown): RuntimeCallable | AuthoredCallable | undefined {
    if (isAuthoredCallable(value)) return value;
    if (isCallable(value)) return value;
    if (!isSerializedCallable(value)) return;
    const declaration = this.declarations.get(value.declaration);
    return declaration ? this.instantiate(declaration, lexicalScope()) : undefined;
  }

  context(ctx: FragmentContext, phase: FragmentContext['phase'] | 'value' = ctx.phase): FragmentContext {
    const enhanced = Object.create(ctx) as FragmentContext;
    Object.defineProperties(enhanced, {
      phase: { value: phase, enumerable: true },
      state: { value: phase === 'value' ? deepReadonly(ctx.state) : ctx.state, enumerable: true },
      makeCallable: {
        value: (id: string, scope: Scope) => {
          const declaration = this.declarations.get(id);
          invariant(declaration, 'E_CALLABLE', `Unknown callable declaration: ${id}`);
          return this.callableValue(declaration, scope);
        },
      },
      invokeValueCallable: {
        value: (value: unknown, args: readonly unknown[]) => this.invokeValue(value, args, enhanced),
      },
    });
    return enhanced;
  }

  evaluate(expression: Expression, ctx: FragmentContext, scope: Scope): unknown {
    return evaluateExpression(expression.ast, this.context(ctx), scope);
  }

  block(body: StoryNode[], parent: Scope): Scope {
    const scope = lexicalScope(parent);
    for (const node of body) {
      if (node.type !== 'callable' || !node.callable.name) continue;
      invariant(
        !Object.hasOwn(scope, node.callable.name),
        'DUPLICATE_CALLABLE',
        `Duplicate callable: ${node.callable.name}`,
      );
      scope[node.callable.name] = this.callableValue(node.callable, scope);
    }
    return scope;
  }

  callee(call: CallableCallIR, ctx: FragmentContext, scope: Scope): unknown {
    if (call.callee.type === 'inline') return this.callableValue(call.callee.callable, scope);
    if (call.callee.type === 'expression') return this.evaluate(call.callee.expression, ctx, scope);
    return (
      bindingOwner(scope, call.callee.name)?.[call.callee.name] ?? ctx.bindings[call.callee.name] ?? call.callee.name
    );
  }

  private boundedCall<T>(invoke: () => T): T {
    invariant(this.callDepth < maxCallDepth, 'CALL_DEPTH', 'Maximum authored callable recursion exceeded.');
    this.callDepth++;
    try {
      return invoke();
    } finally {
      this.callDepth--;
    }
  }

  invokeEffect(call: CallableCallIR, ctx: FragmentContext, caller: Scope, values?: readonly unknown[]): void {
    this.boundedCall(() => this.invokeEffectUnchecked(call, ctx, caller, values));
  }

  private invokeEffectUnchecked(
    call: CallableCallIR,
    ctx: FragmentContext,
    caller: Scope,
    values?: readonly unknown[],
  ): void {
    const target = this.resolve(this.callee(call, ctx, caller));
    invariant(target, 'E_CALLABLE', 'An effect call requires an authored callable.');
    invariant(target.phase === 'effect', 'E_CALLABLE_PHASE', `Cannot call a ${target.phase} callable as an effect.`);
    if (isAuthoredCallable(target)) {
      target.invoke(...(values ?? call.args.map((argument) => this.evaluate(argument, ctx, caller))), ctx);
      return;
    }
    const child = lexicalScope(target.environment, { __temporary: Object.create(null) as Scope });
    bindParameters(
      target.declaration.params,
      values ?? call.args.map((argument) => this.evaluate(argument, ctx, caller)),
      ctx,
      child,
    );
    executeEffects(target.declaration.body as EffectNode[], ctx, child, this);
  }

  invokeValue(value: unknown, args: readonly unknown[], ctx: FragmentContext): unknown {
    return this.boundedCall(() => this.invokeValueUnchecked(value, args, ctx));
  }

  private invokeValueUnchecked(value: unknown, args: readonly unknown[], ctx: FragmentContext): unknown {
    const target = this.resolve(value);
    invariant(target, 'E_CALLABLE', 'A value call requires an authored callable.');
    invariant(target.phase === 'value', 'E_CALLABLE_PHASE', `Cannot call a ${target.phase} callable as a value.`);
    if (isAuthoredCallable(target)) return target.invoke(...args, ctx);
    const child = lexicalScope(target.environment, { __temporary: Object.create(null) as Scope });
    bindParameters(target.declaration.params, args, ctx, child);
    const body = target.declaration.body as ValueCallableBodyIR;
    const valueContext = this.context(ctx, 'value');
    executeEffects(body.effects, valueContext, child, this);
    return evaluateExpression(body.result.ast, valueContext, child);
  }
}
