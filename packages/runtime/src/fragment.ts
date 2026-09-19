/** Fragment constructors and semantic-IR rendering adapter. */
import {
  display,
  evaluateExpression,
  executeStatements,
  invariant,
  type AnyFragment,
  type Expression,
  type Fragment,
  type FragmentContext,
  type FragmentProps,
  type Metadata,
  type PassageIR,
  type Scope,
  type StoryNode,
  type View,
  type ViewInput,
} from '@gneh/core';

export interface FragmentDefinition<P extends object> {
  id: string;
  metadata?: Metadata;
  capabilities?: string[];
  bindings?: Readonly<Record<string, unknown>>;
  enter?: (ctx: FragmentContext, props: P) => void;
  render: (ctx: FragmentContext, props: P) => ViewInput;
}

export function defineFragment<P extends object = FragmentProps>(definition: FragmentDefinition<P>): Fragment<P> {
  invariant(!!definition.id, 'FRAGMENT_ID', 'A fragment requires a stable id.');
  return Object.freeze({
    kind: 'gneh.fragment' as const,
    id: definition.id,
    metadata: definition.metadata ?? {},
    capabilities: definition.capabilities ?? [],
    bindings: definition.bindings,
    enter: definition.enter,
    render: definition.render,
  });
}

export function defineIRFragment(
  ir: PassageIR,
  options: {
    bindings?: Record<string, unknown>;
  } = {},
): Fragment {
  const evaluateValue = (e: Expression, ctx: FragmentContext, scope: Scope) => evaluateExpression(e.ast, ctx, scope);
  const valueAt = (e: Expression, ctx: FragmentContext, scope: Scope, key: string) =>
    ir.evaluation === 'materialized'
      ? ctx.local(`value:${key}`, (initial) => evaluateValue(e, initial, scope))
      : evaluateValue(e, ctx, scope);
  function nodes(body: StoryNode[], ctx: FragmentContext, scope: Scope, path: string): View[] {
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
          ctx.effect(key, (initial) => executeStatements(node.statements, initial, { ...scope }));
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
            const childScope = { ...scope, [node.name]: item, _index: i, index: i };
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
        case 'button':
          return [
            {
              kind: 'button',
              key,
              children: nodes(node.children, ctx, scope, key),
              activate: () =>
                ctx.dispatch((actionCtx) => {
                  const action = ir.actions[node.action];
                  invariant(action, 'ACTION_MISSING', `Unknown action: ${node.action}`);
                  executeStatements(action.statements, actionCtx, { ...scope });
                }),
            },
          ];
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
                  // Materialize the newly revealed flow inside the transaction so
                  // its source-order effects participate in rollback/history.
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
          const action = ir.actions[node.action];
          invariant(action, 'ACTION_MISSING', `Unknown action: ${node.action}`);
          const options = node.options.map((option, optionIndex) =>
            valueAt(option, ctx, scope, `${key}/option:${optionIndex}`),
          );
          // Bound controls intentionally observe current state even in an otherwise
          // materialized Harlowe passage; 2bind is a live UI contract.
          const value = evaluateValue(node.value, ctx, scope);
          return [
            {
              kind: `control:${node.control}`,
              key,
              attrs: { options, value, checked: Boolean(value) },
              children: nodes(node.label, ctx, scope, key + '/label'),
              change: (value) =>
                ctx.dispatch((actionCtx) => executeStatements(action.statements, actionCtx, { ...scope, value })),
            },
          ];
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
  // Keep the object ABI identical for interpreted data, generated ESM and handwritten JS.
  return Object.freeze({
    kind: 'gneh.fragment' as const,
    id: ir.id,
    metadata: ir.metadata,
    capabilities: ir.capabilities,
    ir,
    bindings: options.bindings,
    enter: (ctx: FragmentContext, props: FragmentProps) =>
      executeStatements(ir.enter, ctx, {
        ...props,
        props,
        __temporary: ctx.local('temporary-scope', () => ({})),
      }),
    render: (ctx: FragmentContext, props: FragmentProps) =>
      nodes(ir.body, ctx, { ...props, props, __temporary: ctx.local('temporary-scope', () => ({})) }, ctx.instanceId),
  });
}

/** Bind props without inventing a separate component or passage runtime type. */
export function bindFragment<P extends object>(fragment: Fragment<P>, props: P, id = fragment.id + ':bound'): Fragment {
  return defineFragment({
    id,
    metadata: { nav: false },
    capabilities: [...fragment.capabilities],
    render(ctx) {
      return ctx.include(fragment as AnyFragment, props as FragmentProps);
    },
  });
}
