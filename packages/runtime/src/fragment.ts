import {
  display,
  bindParameters,
  executeEffects,
  invariant,
  lexicalScope,
  type Expression,
  type Fragment,
  type FragmentContext,
  type FragmentProps,
  type PassageIR,
  type Scope,
  type StoryNode,
  type View,
} from '@gneh/core';
import { CallableRuntime, type ChildrenInvocation } from './callables.js';

export function defineIRFragment(
  ir: PassageIR,
  options: {
    bindings?: Record<string, unknown>;
  } = {},
): Fragment {
  const runtime = new CallableRuntime(ir);
  const evaluateValue = (expression: Expression, ctx: FragmentContext, scope: Scope) =>
    runtime.evaluate(expression, ctx, scope);
  const blockScope = (body: StoryNode[], parent: Scope) => runtime.block(body, parent);
  const withConstants = (ctx: FragmentContext, scope: Scope): Scope => {
    const result = lexicalScope(scope);
    for (const [name, expression] of Object.entries(ir.constants))
      result[name] = evaluateValue(expression, ctx, result);
    return result;
  };
  const valueAt = (e: Expression, ctx: FragmentContext, scope: Scope, key: string) =>
    ir.evaluation === 'materialized'
      ? ctx.local(`value:${key}`, (initial) => evaluateValue(e, initial, scope))
      : evaluateValue(e, ctx, scope);
  function nodes(body: StoryNode[], ctx: FragmentContext, parent: Scope, path: string, existing = false): View[] {
    const scope = existing ? parent : blockScope(body, parent);
    return body.flatMap((node, index): View[] => {
      ctx.step();
      const key = `${path}/${node.span.start}:${index}`;
      switch (node.type) {
        case 'text':
          return [{ kind: 'text', text: node.value, key }];
        case 'content':
          return [
            {
              kind: node.kind,
              key,
              attrs: node.attrs,
              children: nodes(node.children, ctx, scope, key),
            },
          ];
        case 'effect':
          ctx.effect(key, (initial) => executeEffects(node.effects, initial, lexicalScope(scope), runtime));
          return [];
        case 'value':
          return [{ kind: 'text', key, text: display(valueAt(node.expression, ctx, scope, key)) }];
        case 'if':
          return nodes(valueAt(node.test, ctx, scope, key + '/test') ? node.yes : node.no, ctx, scope, key + '/branch');
        case 'each': {
          const items = valueAt(node.items, ctx, scope, key + '/items');
          invariant(Array.isArray(items), 'E_ITERABLE', 'A structural loop requires an array.');
          const seen = new Set<string>();
          return items.flatMap((item, i) => {
            const childScope = lexicalScope(scope, { [node.name]: item, _index: i, index: i });
            const identity = node.key
              ? valueAt(node.key, ctx, childScope, key + `/key:${i}`)
              : item && typeof item === 'object' && Object.hasOwn(item, 'id')
                ? item.id
                : i;
            invariant(['string', 'number'].includes(typeof identity), 'E_KEY', 'Loop keys must be strings or numbers.');
            const stable = JSON.stringify(identity);
            invariant(!seen.has(stable), 'DUPLICATE_KEY', `Duplicate loop key: ${stable}`);
            seen.add(stable);
            return nodes(node.children, ctx, childScope, key + '/' + stable);
          });
        }
        case 'include': {
          const props = node.props ? valueAt(node.props, ctx, scope, key + '/props') : {};
          invariant(
            props && typeof props === 'object' && !Array.isArray(props),
            'E_PROPS',
            'Fragment props must be an object.',
          );
          return ctx.include(node.target, props as FragmentProps, key);
        }
        case 'choice':
          return [
            {
              kind: 'choice',
              key,
              attrs: { target: node.target },
              children: nodes(node.children, ctx, scope, key),
              activate: () => {
                const props = node.props ? valueAt(node.props, ctx, scope, key + '/props') : {};
                ctx.navigate(node.target, props as FragmentProps);
              },
            },
          ];
        case 'button': {
          const invocation = { call: node.action, environment: scope };
          return [
            {
              kind: 'button',
              key,
              children: nodes(node.children, ctx, scope, key),
              activate: () =>
                ctx.dispatch((actionCtx) => {
                  runtime.invokeEffect(invocation.call, actionCtx, invocation.environment);
                }),
            },
          ];
        }
        case 'interaction': {
          const countKey = `interaction:${key}`;
          const count = ctx.local(countKey, () => 0);
          const revealed = Array.from({ length: count }, (_, revealIndex) =>
            nodes(node.children, ctx, scope, `${key}/reveal:${revealIndex}`),
          ).flat();
          if (node.behavior === 'reveal' && count) return revealed;
          return [
            {
              kind: 'button',
              key: key + '/trigger',
              children: nodes(node.label, ctx, scope, key + '/label'),
              activate: () =>
                ctx.dispatch((actionCtx) => {
                  const current = actionCtx.local(countKey, () => 0);
                  if (node.behavior === 'reveal' && current) return;
                  actionCtx.setLocal(countKey, current + 1);
                  nodes(node.children, actionCtx, scope, `${key}/reveal:${current}`);
                }),
            },
            ...revealed,
          ];
        }
        case 'region':
          return [ctx.regionView(node.name, () => nodes(node.children, ctx, scope, key))];
        case 'region-change':
          ctx.effect(key, (initial) => {
            const content = nodes(node.children, initial, scope, key + '/content');
            const region = initial.region(node.name);
            if (node.mode === 'replace') region.set(content);
            else if (node.mode === 'prepend') region.prepend(content);
            else region.append(content);
          });
          return [];
        case 'portal':
          ctx.effect(key, (initial) => {
            const cleanup = initial.host('portal', [
              node.name,
              node.mode,
              nodes(node.children, initial, scope, key + '/content'),
            ]);
            if (typeof cleanup === 'function') initial.onDispose(cleanup as () => void);
          });
          return [];
        case 'control': {
          const invocation = { call: node.action, environment: scope };
          const options = node.options.map((option, optionIndex) =>
            valueAt(option, ctx, scope, `${key}/option:${optionIndex}`),
          );
          const value = evaluateValue(node.value, ctx, scope);
          return [
            {
              kind: `control:${node.control}`,
              key,
              attrs: { options, value, checked: Boolean(value) },
              children: nodes(node.label, ctx, scope, key + '/label'),
              change: (value) =>
                ctx.dispatch((actionCtx) =>
                  runtime.invokeEffect(invocation.call, actionCtx, invocation.environment, [value]),
                ),
            },
          ];
        }
        case 'call': {
          const rawTarget = runtime.callee(node.call, ctx, scope);
          const target = runtime.resolve(rawTarget);
          if (!target) {
            const props = node.call.args[0] ? valueAt(node.call.args[0], ctx, scope, `${key}/props`) : {};
            invariant(
              props && typeof props === 'object' && !Array.isArray(props),
              'E_PROPS',
              'Fragment props must be an object.',
            );
            return typeof rawTarget === 'string'
              ? ctx.include(rawTarget, props as FragmentProps, key)
              : ctx.include(rawTarget as import('@gneh/core').AnyFragment, props as FragmentProps, key);
          }
          const args = node.call.args.map((argument, index) =>
            valueAt(argument, ctx, scope, `${key}/argument:${index}`),
          );
          if (target.phase === 'value')
            return [{ kind: 'text', key, text: display(runtime.invokeValue(target, args, ctx)) }];
          invariant(target.phase === 'view', 'E_CALLABLE_PHASE', `Cannot call a ${target.phase} callable as a view.`);
          const child = lexicalScope(target.environment, {
            __temporary: Object.create(null) as Scope,
            __children: {
              body: node.children,
              environment: scope,
              path: `${key}/children`,
            } satisfies ChildrenInvocation,
          });
          bindParameters(target.declaration.params, args, ctx, child);
          return nodes(target.declaration.body as StoryNode[], ctx, child, `${key}/callable`, false);
        }
        case 'callable':
          return [];
        case 'children': {
          const renderChildren = scope.__children;
          invariant(
            renderChildren && typeof renderChildren === 'object',
            'E_CHILDREN',
            '@children is only available inside a view.',
          );
          const invocation = renderChildren as ChildrenInvocation;
          return nodes(invocation.body, ctx, invocation.environment, invocation.path);
        }
        case 'extension':
          return [
            {
              kind: `extension:${node.name}`,
              key,
              attrs: {
                ...node.attrs,
                ...Object.fromEntries(
                  Object.entries(node.bindings).map(([k, e]) => [k, valueAt(e, ctx, scope, `${key}/binding:${k}`)]),
                ),
              },
              children: nodes(node.children, ctx, scope, key),
            },
          ];
        case 'invoke': {
          if (node.phase === 'effect') {
            ctx.effect(key, (initial) => {
              const args = node.args.map((argument, argumentIndex) =>
                valueAt(argument, initial, scope, `${key}/argument:${argumentIndex}`),
              );
              initial.invokeExtension(node.id, 'effect', args, () =>
                nodes(node.children, initial, scope, key + '/children'),
              );
            });
            return [];
          }
          const args = node.args.map((argument, argumentIndex) =>
            valueAt(argument, ctx, scope, `${key}/argument:${argumentIndex}`),
          );
          const children = () => nodes(node.children, ctx, scope, key + '/children');
          return ctx.invokeExtension(node.id, 'view', args, children);
        }
      }
    });
  }
  return Object.freeze({
    kind: 'gneh.fragment' as const,
    id: ir.id,
    metadata: ir.metadata,
    capabilities: ir.capabilities,
    ir,
    bindings: options.bindings,
    enter: (ctx: FragmentContext, props: FragmentProps) =>
      executeEffects(
        ir.enter,
        ctx,
        blockScope(
          ir.body,
          withConstants(
            ctx,
            lexicalScope(undefined, {
              ...props,
              props,
              __temporary: ctx.local('temporary-scope', () => Object.create(null) as Scope),
            }),
          ),
        ),
        runtime,
      ),
    render: (ctx: FragmentContext, props: FragmentProps) => {
      const root = blockScope(
        ir.body,
        withConstants(
          ctx,
          lexicalScope(undefined, {
            ...props,
            props,
            __temporary: ctx.local('temporary-scope', () => Object.create(null) as Scope),
          }),
        ),
      );
      return nodes(ir.body, ctx, root, ctx.instanceId, true);
    },
  });
}
