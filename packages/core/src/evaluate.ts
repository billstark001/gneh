import { GnehError, invariant } from './errors.js';
import { intrinsicById } from './intrinsics.js';
import type { BinaryOp, Expr, ReferenceNamespace, Statement } from './ir.js';
import { assertJson, display, safeKey } from './json.js';
import type { EvaluationContext, Scope } from './view.js';

const pureMethods = new Set([
  'includes',
  'indexOf',
  'lastIndexOf',
  'slice',
  'substring',
  'substr',
  'startsWith',
  'endsWith',
  'toUpperCase',
  'toLowerCase',
  'trim',
  'split',
  'join',
  'concat',
  'at',
  'map',
  'filter',
  'find',
  'findIndex',
  'some',
  'every',
  'reduce',
  'flat',
  'flatMap',
  'toSorted',
  'toReversed',
  'toSpliced',
]);

const writeMethods = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse']);

const intrinsicValues: Record<string, unknown> = {
  math: Object.freeze(
    Object.fromEntries(
      Object.getOwnPropertyNames(Math)
        .filter((key) => key !== 'random')
        .map((key) => [key, (Math as unknown as Record<string, unknown>)[key]]),
    ),
  ),
  number: Number,
  string: String,
  boolean: Boolean,
  object: Object.freeze({ keys: Object.keys, values: Object.values, entries: Object.entries }),
  'array-constructor': Object.freeze({ isArray: Array.isArray }),
  undefined,
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
};

export function resolveReference(
  ctx: EvaluationContext,
  scope: Scope,
  namespace: ReferenceNamespace,
  name: string,
): unknown {
  if (namespace === 'state' && name === '*') return ctx.state;
  safeKey(name);
  if (namespace === 'state') return get(ctx.state, name);
  if (namespace === 'props') return scope.props;
  if (namespace === 'temporary') {
    if (Object.hasOwn(scope, name)) return scope[name];
    const temporary = scope.__temporary;
    if (temporary && typeof temporary === 'object' && Object.hasOwn(temporary, name)) return (temporary as Scope)[name];
    return undefined;
  }
  if (namespace === 'lexical') {
    if (Object.hasOwn(scope, name)) return scope[name];
    throw new GnehError('E_NAME', `Unknown ${namespace} binding: ${name}`);
  }
  if (namespace === 'binding') {
    if (Object.hasOwn(ctx.bindings, name)) return ctx.bindings[name];
    throw new GnehError('E_NAME', `Unknown host binding: ${name}`);
  }
  const definition = intrinsicById(name);
  invariant(definition, 'E_INTRINSIC', `Unknown intrinsic: ${name}`);
  invariant(
    definition.phases.includes(ctx.phase),
    'E_PURITY',
    `${definition.names[0]} is unavailable during ${ctx.phase}.`,
  );
  if (name === 'random' || name === 'either') {
    invariant(
      ctx.phase !== 'render',
      'E_PURITY',
      'Randomness is only available in enter/actions. Store its result in state.',
    );
    return name === 'random'
      ? (min: number, max: number) => ctx.random(min, max)
      : (...values: unknown[]) => values[ctx.random(0, values.length - 1)];
  }
  if (Object.hasOwn(intrinsicValues, name)) return intrinsicValues[name];
  throw new GnehError('E_INTRINSIC', `Intrinsic has no implementation: ${name}`);
}

export function get(object: unknown, key: unknown, optional = false): unknown {
  if (object == null && optional) return undefined;
  invariant(object != null, 'E_NULL', `Cannot read ${String(key)} from ${String(object)}`);
  const safe = safeKey(key);
  if (Array.isArray(object) || typeof object === 'string') {
    if (safe === 'length' || /^\d+$/.test(safe) || pureMethods.has(safe) || writeMethods.has(safe))
      return (object as unknown as Record<string, unknown>)[safe];
    return undefined;
  }
  invariant(typeof object === 'object', 'E_MEMBER', 'Only data values have accessible members.');
  return Object.hasOwn(object, safe) ? (object as Scope)[safe] : undefined;
}

export function call(
  ctx: EvaluationContext,
  fn: unknown,
  args: unknown[],
  receiver?: unknown,
  method?: string,
  optional = false,
): unknown {
  ctx.step();
  if (fn == null && optional) return undefined;
  invariant(typeof fn === 'function', 'E_CALL', 'Value is not callable.');
  if (method && (Array.isArray(receiver) || typeof receiver === 'string'))
    invariant(
      pureMethods.has(method) || (ctx.phase !== 'render' && writeMethods.has(method)),
      'E_PURITY',
      `Method ${method} is not available during ${ctx.phase}.`,
    );
  return Reflect.apply(fn, receiver, args);
}

// A sentinel distinguishes `a?.b.c` from `(a?.b).c`.
const chainStopped = Symbol('gneh.optional-chain');

export function chainResult(value: unknown): unknown {
  return value === chainStopped ? undefined : value;
}

export function chainGet(object: unknown, key: () => unknown, optional: boolean): unknown {
  if (object === chainStopped || (optional && object == null)) return chainStopped;
  return get(object, key());
}

export function chainCall(ctx: EvaluationContext, fn: unknown, args: () => unknown[], optional: boolean): unknown {
  if (fn === chainStopped || (optional && fn == null)) return chainStopped;
  return call(ctx, fn, args());
}

export function chainMethod(
  ctx: EvaluationContext,
  receiver: unknown,
  keyFn: () => unknown,
  args: () => unknown[],
  memberOptional: boolean,
  callOptional: boolean,
): unknown {
  if (receiver === chainStopped || (memberOptional && receiver == null)) return chainStopped;
  const key = safeKey(keyFn());
  const fn = get(receiver, key);
  if (callOptional && fn == null) return chainStopped;
  return call(ctx, fn, args(), receiver, key);
}

function evaluateChain(expr: Expr, ctx: EvaluationContext, scope: Scope): unknown {
  if (expr.type === 'get') {
    ctx.step();
    return chainGet(evaluateChain(expr.object, ctx, scope), () => evaluate(expr.key, ctx, scope), expr.optional);
  }
  if (expr.type === 'call') {
    ctx.step();
    if (expr.callee.type === 'get') {
      const member = expr.callee;
      return chainMethod(
        ctx,
        evaluateChain(member.object, ctx, scope),
        () => evaluate(member.key, ctx, scope),
        () => expr.args.map((arg) => evaluate(arg, ctx, scope)),
        member.optional,
        expr.optional,
      );
    }
    return chainCall(
      ctx,
      evaluateChain(expr.callee, ctx, scope),
      () => expr.args.map((arg) => evaluate(arg, ctx, scope)),
      expr.optional,
    );
  }
  return evaluate(expr, ctx, scope);
}

export function unary(op: string, value: unknown): unknown {
  switch (op) {
    case '!':
      return !value;
    case '+':
      return +(value as number);
    case '-':
      return -(value as number);
    case 'typeof':
      return typeof value;
    default:
      throw new GnehError('E_OPERATOR', `Unsupported unary ${op}`);
  }
}

export function binary(op: BinaryOp, left: unknown, right: unknown): unknown {
  switch (op) {
    case '+':
      return typeof left === 'string' || typeof right === 'string'
        ? String(left) + String(right)
        : (left as number) + (right as number);
    case '-':
      return (left as number) - (right as number);
    case '*':
      return (left as number) * (right as number);
    case '/':
      return (left as number) / (right as number);
    case '%':
      return (left as number) % (right as number);
    case '**':
      return (left as number) ** (right as number);
    case '===':
      return left === right;
    case '!==':
      return left !== right;
    case '==':
      return left == right;
    case '!=':
      return left != right;
    case '>':
      return (left as number) > (right as number);
    case '<':
      return (left as number) < (right as number);
    case '>=':
      return (left as number) >= (right as number);
    case '<=':
      return (left as number) <= (right as number);
    default:
      throw new GnehError('E_OPERATOR', `Unsupported operator ${op}`);
  }
}

/** Evaluate the deliberately small, side-effect-checked expression IR. */
export function evaluate(expr: Expr, ctx: EvaluationContext, scope: Scope): unknown {
  ctx.step();
  switch (expr.type) {
    case 'literal':
      return expr.value;
    case 'reference':
      return resolveReference(ctx, scope, expr.namespace, expr.name);
    case 'array':
      return expr.items.map((item) => evaluate(item, ctx, scope));
    case 'object':
      return Object.fromEntries(expr.entries.map(([key, value]) => [safeKey(key), evaluate(value, ctx, scope)]));
    case 'unary':
      return unary(expr.op, evaluate(expr.value, ctx, scope));
    case 'binary': {
      const left = evaluate(expr.left, ctx, scope);
      if (expr.op === '&&') return left && evaluate(expr.right, ctx, scope);
      if (expr.op === '||') return left || evaluate(expr.right, ctx, scope);
      if (expr.op === '??') return left ?? evaluate(expr.right, ctx, scope);
      return binary(expr.op, left, evaluate(expr.right, ctx, scope));
    }
    case 'conditional':
      return evaluate(evaluate(expr.test, ctx, scope) ? expr.yes : expr.no, ctx, scope);
    case 'chain':
      return chainResult(evaluateChain(expr.value, ctx, scope));
    case 'get': {
      const object = evaluate(expr.object, ctx, scope);
      return object == null && expr.optional ? undefined : get(object, evaluate(expr.key, ctx, scope));
    }
    case 'call': {
      if (expr.callee.type === 'get') {
        const receiver = evaluate(expr.callee.object, ctx, scope);
        const key = safeKey(evaluate(expr.callee.key, ctx, scope));
        if (receiver == null && expr.callee.optional) return undefined;
        return call(
          ctx,
          get(receiver, key, expr.callee.optional),
          expr.args.map((arg) => evaluate(arg, ctx, scope)),
          receiver,
          key,
          expr.optional,
        );
      }
      return call(
        ctx,
        evaluate(expr.callee, ctx, scope),
        expr.args.map((arg) => evaluate(arg, ctx, scope)),
        undefined,
        undefined,
        expr.optional,
      );
    }
    case 'arrow':
      return (...args: unknown[]) =>
        evaluate(expr.body, ctx, {
          ...scope,
          ...Object.fromEntries(expr.params.map((param, index) => [param, args[index]])),
        });
    case 'template':
      return expr.parts.map((part) => (typeof part === 'string' ? part : display(evaluate(part, ctx, scope)))).join('');
  }
}

function assign(target: Expr, value: unknown, ctx: EvaluationContext, scope: Scope): void {
  invariant(ctx.phase !== 'render', 'E_PURITY', 'Render expressions cannot write state.');
  if (target.type === 'reference' && target.namespace === 'state') {
    invariant(target.name !== '*', 'E_ASSIGN', 'Cannot replace the state root.');
    assertJson(value);
    ctx.state[safeKey(target.name)] = value;
    return;
  }
  if (target.type === 'reference' && target.namespace === 'temporary') {
    if (Object.hasOwn(scope, target.name)) scope[target.name] = value;
    else {
      const temporary = scope.__temporary;
      invariant(temporary && typeof temporary === 'object', 'E_ASSIGN', 'Missing temporary scope.');
      (temporary as Scope)[safeKey(target.name)] = value;
    }
    return;
  }
  if (target.type === 'reference' && target.namespace === 'lexical') {
    safeKey(target.name);
    invariant(target.name !== 'props' && target.name !== 'state', 'E_ASSIGN', 'Cannot replace a context binding.');
    scope[target.name] = value;
    return;
  }
  if (target.type === 'get') {
    let root = target.object;
    while (root.type === 'get') root = root.object;
    invariant(
      (root.type === 'reference' && root.namespace === 'state') ||
        (root.type === 'reference' && (root.namespace === 'lexical' || root.namespace === 'temporary')),
      'E_ASSIGN',
      'Assignments must target state or an action-local value.',
    );
    const object = evaluate(target.object, ctx, scope);
    const key = safeKey(evaluate(target.key, ctx, scope));
    invariant(typeof object === 'object' && object !== null, 'E_ASSIGN', 'Assignment target is not an object.');
    assertJson(value);
    (object as Scope)[key] = value;
    return;
  }
  throw new GnehError('E_ASSIGN', 'Invalid assignment target.');
}

export function execute(statements: Statement[], ctx: EvaluationContext, scope: Scope): void {
  invariant(ctx.phase !== 'render', 'E_PURITY', 'Statements require an enter/action context.');
  for (const statement of statements) {
    ctx.step();
    switch (statement.type) {
      case 'assign': {
        const value = evaluate(statement.value, ctx, scope);
        assign(
          statement.target,
          statement.op === '='
            ? value
            : binary(statement.op.slice(0, -1) as BinaryOp, evaluate(statement.target, ctx, scope), value),
          ctx,
          scope,
        );
        break;
      }
      case 'declare':
        scope[safeKey(statement.name)] = evaluate(statement.value, ctx, scope);
        break;
      case 'call':
        evaluate(statement.expression, ctx, scope);
        break;
      case 'if':
        execute(evaluate(statement.test, ctx, scope) ? statement.yes : statement.no, ctx, scope);
        break;
      case 'each': {
        const items = evaluate(statement.items, ctx, scope);
        invariant(Array.isArray(items), 'E_ITERABLE', 'Loop requires an array.');
        for (const item of items) execute(statement.body, ctx, { ...scope, [statement.name]: item });
        break;
      }
    }
  }
}

/** Helpers referenced by generated ESM; keep this surface stable with the interpreter. */
export const ops = {
  chainResult,
  chainGet,
  chainCall,
  chainMethod,
  get,
  resolveReference,
  call,
  unary,
  binary,
  display,
};
