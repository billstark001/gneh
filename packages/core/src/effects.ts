import { invariant } from './errors.js';
import { evaluateExpression } from './expression-runtime.js';
import { safeKey } from './json.js';
import { lexicalScope } from './scope.js';
import type { BindingPattern } from 'pure-expr/expr';
import type { CallableCallIR, CallableIR, EffectNode } from './ir.js';
import type { EvaluationContext, Scope } from './view.js';

export function bindPattern(pattern: BindingPattern, value: unknown, ctx: EvaluationContext, scope: Scope): void {
  switch (pattern.type) {
    case 'Identifier':
      invariant(!pattern.name.startsWith('$'), 'E_BINDING', 'Persistent state cannot be declared as a local binding.');
      scope[safeKey(pattern.name)] = value;
      return;
    case 'AssignmentPattern':
      bindPattern(
        pattern.left,
        value === undefined ? evaluateExpression(pattern.right, ctx, scope) : value,
        ctx,
        scope,
      );
      return;
    case 'RestElement':
      bindPattern(pattern.argument, value, ctx, scope);
      return;
    case 'ArrayPattern': {
      invariant(Array.isArray(value), 'E_BINDING', 'Array binding requires an array value.');
      let index = 0;
      for (const item of pattern.elements) {
        if (!item) {
          index++;
          continue;
        }
        if (item.type === 'RestElement') bindPattern(item, value.slice(index), ctx, scope);
        else bindPattern(item, value[index++], ctx, scope);
      }
      return;
    }
    case 'ObjectPattern': {
      invariant(value !== null && typeof value === 'object', 'E_BINDING', 'Object binding requires an object value.');
      const record = value as Record<string, unknown>;
      const used = new Set<string>();
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') {
          bindPattern(
            property,
            Object.fromEntries(Object.entries(record).filter(([key]) => !used.has(key))),
            ctx,
            scope,
          );
          continue;
        }
        let key: string;
        if (property.computed) key = safeKey(evaluateExpression(property.key, ctx, scope));
        else if (property.key.type === 'Identifier') key = safeKey(property.key.name);
        else if (property.key.type === 'Literal') key = safeKey(property.key.value);
        else throw new Error('Invalid object binding key.');
        used.add(key);
        bindPattern(property.value, record[key], ctx, scope);
      }
    }
  }
}

function declaredNames(pattern: BindingPattern): string[] {
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name];
    case 'AssignmentPattern':
      return declaredNames(pattern.left);
    case 'RestElement':
      return declaredNames(pattern.argument);
    case 'ArrayPattern':
      return pattern.elements.flatMap((item) => (item ? declaredNames(item) : []));
    case 'ObjectPattern':
      return pattern.properties.flatMap((item) =>
        item.type === 'RestElement' ? declaredNames(item) : declaredNames(item.value),
      );
  }
}

function declarePattern(
  pattern: BindingPattern,
  value: unknown,
  mutable: boolean,
  ctx: EvaluationContext,
  scope: Scope,
): void {
  if (pattern.type === 'Identifier' && pattern.name.startsWith('$')) {
    invariant(mutable, 'E_BINDING', 'Persistent state cannot be declared constant.');
    ctx.state[safeKey(pattern.name.slice(1))] = value as never;
    return;
  }
  for (const name of declaredNames(pattern)) {
    invariant(!name.startsWith('$'), 'E_BINDING', 'Persistent state cannot be declared as a lexical binding.');
    const key = safeKey(name);
    invariant(!Object.hasOwn(scope, key), 'DUPLICATE_BINDING', `Duplicate lexical declaration: ${name}`);
    Object.defineProperty(scope, key, { value: undefined, writable: true, enumerable: true, configurable: true });
  }
  bindPattern(pattern, value, ctx, scope);
  if (!mutable)
    for (const name of declaredNames(pattern)) Object.defineProperty(scope, safeKey(name), { writable: false });
}

export interface EffectCallableRuntime {
  invokeEffect(call: CallableCallIR, ctx: EvaluationContext, scope: Scope, values?: readonly unknown[]): void;
  callableValue(callable: CallableIR, scope: Scope): unknown;
}

export function bindParameters(
  patterns: readonly BindingPattern[],
  values: readonly unknown[],
  ctx: EvaluationContext,
  scope: Scope,
): void {
  for (let index = 0; index < patterns.length; index++) {
    const pattern = patterns[index];
    for (const name of declaredNames(pattern)) {
      invariant(!Object.hasOwn(scope, safeKey(name)), 'DUPLICATE_BINDING', `Duplicate parameter: ${name}`);
      Object.defineProperty(scope, safeKey(name), {
        value: undefined,
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    if (pattern.type === 'RestElement') {
      bindPattern(pattern, values.slice(index), ctx, scope);
      break;
    }
    bindPattern(pattern, values[index], ctx, scope);
  }
}

/** Execute Inkdown effect control flow; expression semantics belong to pure-expr. */
export function executeEffects(
  effects: EffectNode[],
  ctx: EvaluationContext,
  scope: Scope,
  runtime: EffectCallableRuntime,
): void {
  invariant(ctx.phase !== 'render', 'E_PURITY', 'Effects require an enter/action context.');
  for (const effect of effects) {
    ctx.step();
    switch (effect.type) {
      case 'expression':
        evaluateExpression(effect.expression, ctx, scope);
        break;
      case 'bind':
        declarePattern(
          effect.binding,
          evaluateExpression(effect.value, ctx, scope),
          effect.mutable ?? true,
          ctx,
          scope,
        );
        break;
      case 'if':
        executeEffects(
          evaluateExpression(effect.test, ctx, scope) ? effect.yes : effect.no,
          ctx,
          lexicalScope(scope),
          runtime,
        );
        break;
      case 'each': {
        const items = evaluateExpression(effect.items, ctx, scope);
        invariant(Array.isArray(items), 'E_ITERABLE', 'Loop requires an array.');
        for (const item of items) {
          const child = lexicalScope(scope);
          bindPattern(effect.binding, item, ctx, child);
          executeEffects(effect.body, ctx, child, runtime);
        }
        break;
      }
      case 'assign-callable': {
        const child = lexicalScope(scope, { gnehCallableValue: runtime.callableValue(effect.callable, scope) });
        evaluateExpression(
          {
            type: 'AssignmentExpression',
            operator: '=',
            left: effect.target,
            right: { type: 'Identifier', name: 'gnehCallableValue' },
          },
          ctx,
          child,
        );
        break;
      }
      case 'publish-callable': {
        invariant('publish' in ctx && typeof ctx.publish === 'function', 'E_PUBLISH', 'Publication requires a Story.');
        ctx.publish(effect.name, runtime.callableValue(effect.callable, scope));
        break;
      }
      case 'call': {
        runtime.invokeEffect(effect.call, ctx, scope);
        break;
      }
    }
  }
}
