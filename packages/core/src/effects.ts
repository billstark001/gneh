import { invariant } from './errors.js';
import { evaluateExpression } from './expression-runtime.js';
import { safeKey } from './json.js';
import type { BindingPattern } from 'pure-expr/expr';
import type { EffectDeclarationIR, EffectNode } from './ir.js';
import type { EvaluationContext, Scope } from './view.js';

export function bindPattern(pattern: BindingPattern, value: unknown, ctx: EvaluationContext, scope: Scope): void {
  switch (pattern.type) {
    case 'Identifier':
      invariant(!pattern.name.startsWith('$'), 'E_BINDING', 'Persistent state cannot be declared as a local binding.');
      scope[safeKey(pattern.name.replace(/^_/, ''))] = value;
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

export type EffectResolver = (name: string) => EffectDeclarationIR | undefined;

export function bindParameters(
  patterns: readonly BindingPattern[],
  values: readonly unknown[],
  ctx: EvaluationContext,
  scope: Scope,
): void {
  for (let index = 0; index < patterns.length; index++) {
    const pattern = patterns[index];
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
  resolve: EffectResolver = () => undefined,
): void {
  invariant(ctx.phase !== 'render', 'E_PURITY', 'Effects require an enter/action context.');
  for (const effect of effects) {
    ctx.step();
    switch (effect.type) {
      case 'expression':
        evaluateExpression(effect.expression, ctx, scope);
        break;
      case 'bind':
        bindPattern(effect.binding, evaluateExpression(effect.value, ctx, scope), ctx, scope);
        break;
      case 'if':
        executeEffects(evaluateExpression(effect.test, ctx, scope) ? effect.yes : effect.no, ctx, scope, resolve);
        break;
      case 'each': {
        const items = evaluateExpression(effect.items, ctx, scope);
        invariant(Array.isArray(items), 'E_ITERABLE', 'Loop requires an array.');
        for (const item of items) {
          const child = { ...scope };
          bindPattern(effect.binding, item, ctx, child);
          executeEffects(effect.body, ctx, child, resolve);
        }
        break;
      }
      case 'invoke': {
        const declaration = resolve(effect.name);
        invariant(declaration, 'E_EFFECT', `Unknown effect: ${effect.name}`);
        const child = { ...scope };
        bindParameters(
          declaration.params,
          effect.args.map((argument) => evaluateExpression(argument, ctx, scope)),
          ctx,
          child,
        );
        executeEffects(declaration.body, ctx, child, resolve);
        break;
      }
    }
  }
}
