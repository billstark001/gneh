import { bindingNames, type EffectNode, type PassageIR, type StoryNode } from '@gneh/core';

export function effectBindings(effects: readonly EffectNode[]): string[] {
  return effects.flatMap((effect) => {
    if (effect.type === 'bind') return bindingNames(effect.binding);
    if (effect.type === 'assign-callable' && effect.target.type === 'Identifier') return [effect.target.name];
    if (
      effect.type === 'expression' &&
      effect.expression.type === 'AssignmentExpression' &&
      effect.expression.operator === '=' &&
      effect.expression.left.type === 'Identifier'
    )
      return [effect.expression.left.name];
    return [];
  });
}

/** Clone IR and namespace only references that resolve to passages rather than lexical/module bindings. */
export function namespacePassage(
  input: PassageIR,
  passageIds: ReadonlyMap<string, string>,
  inheritedNames: ReadonlySet<string>,
): PassageIR {
  const passage = structuredClone(input);
  const rewriteExpression = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (
      node.type === 'CallExpression' &&
      (node.callee as { type?: string; name?: string } | undefined)?.type === 'Identifier' &&
      (node.callee as { name?: string }).name === 'navigate'
    ) {
      const target = (node.arguments as { type?: string; value?: unknown }[] | undefined)?.[0];
      if (target?.type === 'Literal' && typeof target.value === 'string')
        target.value = passageIds.get(target.value) ?? target.value;
    }
    for (const child of Object.values(node))
      if (Array.isArray(child)) child.forEach(rewriteExpression);
      else rewriteExpression(child);
  };
  const rewriteNodes = (nodes: StoryNode[], inherited: ReadonlySet<string>): void => {
    const names = new Set(inherited);
    for (const node of nodes) {
      if (node.type === 'include' || node.type === 'choice') node.target = passageIds.get(node.target) ?? node.target;
      if (node.type === 'call' && node.call.callee.type === 'binding' && !names.has(node.call.callee.name))
        node.call.callee.name = passageIds.get(node.call.callee.name) ?? node.call.callee.name;
      rewriteExpression(node);
      if (node.type === 'callable') {
        if (node.callable.name) names.add(node.callable.name);
        if (node.callable.phase === 'view') {
          const callableNames = new Set(names);
          node.callable.params.flatMap(bindingNames).forEach((name) => callableNames.add(name));
          rewriteNodes(node.callable.body as StoryNode[], callableNames);
        }
      } else if (node.type === 'effect') effectBindings(node.effects).forEach((name) => names.add(name));
      else if (node.type === 'if') {
        rewriteNodes(node.yes, names);
        rewriteNodes(node.no, names);
      } else if ('children' in node) rewriteNodes(node.children, names);
      if (node.type === 'interaction') rewriteNodes(node.label, names);
      if (node.type === 'control') rewriteNodes(node.label, names);
    }
  };
  rewriteNodes(passage.body, inheritedNames);
  return passage;
}
