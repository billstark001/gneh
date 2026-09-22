import {
  assertJson,
  cloneState,
  invariant,
  normalizeView,
  type Flow,
  type FlowEach,
  type FlowNode,
  type FragmentContext,
  type Json,
  type RenderEvaluation,
  type RenderInput,
  type View,
  type ViewInput,
} from '@gneh/core';

/** Evaluate declarative flow and project its revealed segments into renderer-neutral views. */
export function evaluateRenderInput(
  context: FragmentContext,
  input: RenderInput,
  path: string,
  projection: 'revealed' | 'current' | 'all' = 'revealed',
): RenderEvaluation {
  const segments: View[][] = [[]];
  const splitBoundaries = (view: View): View[] => {
    if (view.kind === 'suspend' || !view.children?.length) return [view];
    const flattened = view.children.flatMap(splitBoundaries);
    if (!flattened.some((child) => child.kind === 'suspend')) return [view];
    const output: View[] = [];
    let children: View[] = [];
    let part = 0;
    const flush = () => {
      if (!children.length) return;
      output.push({ ...view, key: view.key ? `${view.key}:flow:${part++}` : undefined, children });
      children = [];
    };
    for (const child of flattened) {
      if (child.kind === 'suspend') {
        flush();
        output.push(child);
      } else children.push(child);
    }
    flush();
    return output;
  };
  const appendViews = (views: View[]) => {
    for (const view of views.flatMap(splitBoundaries)) {
      if (view.kind === 'suspend') {
        if (segments.at(-1)!.length || segments.length === 1) segments.push([]);
        if (view.attrs?.active) break;
      } else segments.at(-1)!.push(view);
    }
  };
  const visit = (value: RenderInput | FlowNode, currentPath: string): void => {
    if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'gneh.flow') {
      const flow = value as Flow;
      for (let index = 0; index < flow.nodes.length && !context.suspended; index++)
        visit(flow.nodes[index], `${currentPath}/${index}`);
      return;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'gneh.flow.lazy') {
      const lazy = value as import('@gneh/core').FlowLazy;
      visit(lazy.render(context), `${currentPath}/${lazy.id ?? 'lazy'}`);
      return;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'gneh.flow.suspend') {
      const suspension = value as import('@gneh/core').FlowSuspend;
      const key = `${currentPath}/${suspension.id ?? 'suspend'}`;
      const stopped = context.suspend(
        key,
        suspension.resume,
        suspension.bind
          ? (resumeValue, actionContext) => {
              actionContext.setContinuation(suspension.bind!, resumeValue ?? null);
            }
          : undefined,
      );
      segments.push([]);
      if (stopped) return;
      return;
    }
    if (value && typeof value === 'object' && !Array.isArray(value) && value.kind === 'gneh.flow.each') {
      const each = value as FlowEach;
      const loopPath = `${currentPath}/${each.id ?? 'each'}`;
      const items = context.continuation(`flow:items:${loopPath}`, (initial) => {
        const resolved = typeof each.items === 'function' ? each.items(initial) : each.items;
        invariant(Array.isArray(resolved), 'E_ITERABLE', 'A flow loop requires an array.');
        assertJson(resolved);
        return cloneState(resolved as Json[]);
      });
      const seen = new Set<string>();
      for (let index = 0; index < items.length && !context.suspended; index++) {
        const item = items[index];
        const identity = each.key(item, index);
        invariant(
          typeof identity === 'string' || typeof identity === 'number',
          'E_KEY',
          'Flow loop keys must be strings or numbers.',
        );
        const stable = JSON.stringify(identity);
        invariant(!seen.has(stable), 'DUPLICATE_KEY', `Duplicate flow loop key: ${stable}`);
        seen.add(stable);
        visit(each.render(item, index, context), `${loopPath}/${stable}`);
      }
      if (!context.suspended) context.deleteContinuation(`flow:items:${loopPath}`);
      return;
    }
    appendViews(normalizeView(value as ViewInput));
  };
  visit(input, path);
  const nonempty = segments.filter((segment) => segment.length > 0);
  const view = projection === 'current' ? (nonempty.at(-1) ?? []) : nonempty.flatMap((segment) => segment);
  return { view, suspended: context.suspended };
}
