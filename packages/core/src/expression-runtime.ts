import {
  JSEvaluator,
  allowAllCalls,
  createEvaluationEnvironment,
  type BindingStore,
  type ExpressionNode,
} from 'pure-expr/expr';
import { invariant } from './errors.js';
import { safeKey } from './json.js';
import type { EvaluationContext, Scope } from './view.js';

const intrinsicValues = Object.freeze({
  Math: Object.freeze(
    Object.fromEntries(
      Object.getOwnPropertyNames(Math)
        .filter((key) => key !== 'random')
        .map((key) => [key, (Math as unknown as Record<string, unknown>)[key]]),
    ),
  ),
  Number,
  String,
  Boolean,
  Object: Object.freeze({ keys: Object.keys, values: Object.values, entries: Object.entries }),
  Array: Object.freeze({ isArray: Array.isArray }),
  contains: (container: unknown, needle: unknown) =>
    typeof container === 'string'
      ? container.includes(String(needle))
      : Array.isArray(container)
        ? container.includes(needle)
        : !!container && typeof container === 'object' && Object.hasOwn(container, safeKey(needle)),
  array: (...items: unknown[]) => items,
  datamap: (...items: unknown[]) => {
    invariant(items.length % 2 === 0, 'E_ARGS', 'datamap requires key/value pairs.');
    const output: Scope = {};
    for (let index = 0; index < items.length; index += 2) output[safeKey(items[index])] = items[index + 1];
    return output;
  },
});

function variables(ctx: EvaluationContext, scope: Scope): BindingStore {
  const temporary = scope.__temporary;
  const temporaryScope = temporary && typeof temporary === 'object' ? (temporary as Scope) : undefined;
  const localName = (name: string) => name.slice(1);
  return {
    has(name) {
      return name.startsWith('$') || name.startsWith('_') || Object.hasOwn(scope, name);
    },
    get(name) {
      if (name.startsWith('$')) return ctx.state[safeKey(localName(name))];
      if (name.startsWith('_')) {
        const key = safeKey(localName(name));
        return Object.hasOwn(scope, key) ? scope[key] : temporaryScope?.[key];
      }
      return scope[name];
    },
    set(name, value) {
      if (name.startsWith('$')) {
        ctx.state[safeKey(localName(name))] = value as never;
        return;
      }
      if (name.startsWith('_')) {
        const key = safeKey(localName(name));
        if (Object.hasOwn(scope, key)) scope[key] = value;
        else {
          invariant(temporaryScope, 'E_ASSIGN', 'Missing temporary scope.');
          temporaryScope[key] = value;
        }
        return;
      }
      invariant(name !== 'props' && name !== 'state', 'E_ASSIGN', 'Cannot replace a context binding.');
      invariant(Object.hasOwn(scope, name), 'E_ASSIGN', `Unknown writable binding: ${name}`);
      scope[safeKey(name)] = value;
    },
    delete(name) {
      if (name.startsWith('$')) return delete ctx.state[safeKey(localName(name))];
      if (name.startsWith('_')) {
        const key = safeKey(localName(name));
        return Object.hasOwn(scope, key) ? delete scope[key] : !!temporaryScope && delete temporaryScope[key];
      }
      return false;
    },
  };
}

function capabilities(ctx: EvaluationContext): Record<string, unknown> {
  const random = (min: number, max: number) => {
    invariant(ctx.phase !== 'render', 'E_PURITY', 'Randomness must be stored during enter/actions.');
    return ctx.random(min, max);
  };
  return {
    ...intrinsicValues,
    random,
    either: (...values: unknown[]) => values[random(0, values.length - 1)],
    ...ctx.bindings,
  };
}

const renderEvaluator = new JSEvaluator(
  {},
  {
    writes: 'deny',
    maxSteps: 100_000,
    maxCallDepth: 128,
    isCallableAllowed: allowAllCalls,
  },
);

const effectEvaluator = new JSEvaluator(
  {},
  {
    writes: 'commit',
    allowMemberWrites: true,
    maxSteps: 100_000,
    maxCallDepth: 128,
    isCallableAllowed: allowAllCalls,
  },
);

const renderCache = new WeakMap<ExpressionNode, (context?: object) => unknown>();
const effectCache = new WeakMap<ExpressionNode, (context?: object) => unknown>();

/** Evaluate the shared restricted ESTree against one Gneh phase and scope. */
export function evaluateExpression(ast: ExpressionNode, ctx: EvaluationContext, scope: Scope): unknown {
  ctx.step();
  const cache = ctx.phase === 'render' ? renderCache : effectCache;
  const evaluator = ctx.phase === 'render' ? renderEvaluator : effectEvaluator;
  let execute = cache.get(ast);
  if (!execute) {
    execute = evaluator.compile(ast);
    cache.set(ast, execute);
  }
  const data = { ...scope, state: ctx.state };
  return execute(
    createEvaluationEnvironment({
      data,
      variables: variables(ctx, scope),
      capabilities: capabilities(ctx),
    }),
  );
}
