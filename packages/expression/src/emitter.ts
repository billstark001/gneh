import type { Expr, Expression, StoryNode } from '@gneh/core';

/** Generate actual JS expression evaluators, not eval/new Function or serialized source. */
export function emitExpression(expr: Expr, inChain = false): string {
  const e = (node: Expr) => emitExpression(node, false),
    ch = (node: Expr) => emitExpression(node, true);
  let body: string;
  switch (expr.type) {
    case 'literal':
      body = JSON.stringify(expr.value);
      break;
    case 'reference':
      body = `ops.resolveReference(c,s,${JSON.stringify(expr.namespace)},${JSON.stringify(expr.name)})`;
      break;
    case 'array':
      body = `[${expr.items.map(e).join(',')}]`;
      break;
    case 'object':
      body = `Object.fromEntries([${expr.entries.map(([k, x]) => `[${JSON.stringify(k)},${e(x)}]`).join(',')}])`;
      break;
    case 'unary':
      body = `ops.unary(${JSON.stringify(expr.op)},${e(expr.value)})`;
      break;
    case 'binary':
      body = ['&&', '||', '??'].includes(expr.op)
        ? `(${e(expr.left)} ${expr.op} ${e(expr.right)})`
        : `ops.binary(${JSON.stringify(expr.op)},${e(expr.left)},${e(expr.right)})`;
      break;
    case 'conditional':
      body = `(${e(expr.test)}?${e(expr.yes)}:${e(expr.no)})`;
      break;
    case 'chain':
      body = `ops.chainResult(${ch(expr.value)})`;
      break;
    case 'get':
      body = inChain
        ? `ops.chainGet(${ch(expr.object)},()=>${e(expr.key)},${expr.optional})`
        : expr.optional
          ? `((r)=>r==null?undefined:ops.get(r,${e(expr.key)}))(${e(expr.object)})`
          : `ops.get(${e(expr.object)},${e(expr.key)})`;
      break;
    case 'call': {
      const args = `[${expr.args.map(e).join(',')}]`;
      if (inChain) {
        if (expr.callee.type === 'get') {
          const g = expr.callee;
          body = `ops.chainMethod(c,${ch(g.object)},()=>${e(g.key)},()=>${args},${g.optional},${expr.optional})`;
        } else body = `ops.chainCall(c,${ch(expr.callee)},()=>${args},${expr.optional})`;
        break;
      }
      if (expr.callee.type === 'get') {
        const g = expr.callee;
        body = `((r,k)=>${g.optional ? 'r==null?undefined:' : ''}ops.call(c,ops.get(r,k,${g.optional}),${args},r,k,${expr.optional}))(${e(g.object)},${e(g.key)})`;
      } else body = `ops.call(c,${e(expr.callee)},${args},undefined,undefined,${expr.optional})`;
      break;
    }
    case 'arrow':
      body = `(...a)=>((s)=>${e(expr.body)})({...s,${expr.params.map((p, i) => `${JSON.stringify(p)}:a[${i}]`).join(',')}})`;
      break;
    case 'template':
      body = `[${expr.parts.map((p) => (typeof p === 'string' ? JSON.stringify(p) : `ops.display(${e(p)})`)).join(',')}].join("")`;
      break;
  }
  return `(c.step(),${body})`;
}

export function expressionKey(expression: Expression): string {
  return `${expression.span.file}:${expression.span.start}:${expression.span.end}:${expression.source}`;
}

export function visitExpressions(nodes: StoryNode[], fn: (e: Expression) => void): void {
  for (const n of nodes) {
    switch (n.type) {
      case 'value':
        fn(n.expression);
        break;
      case 'if':
        fn(n.test);
        visitExpressions(n.yes, fn);
        visitExpressions(n.no, fn);
        break;
      case 'each':
        fn(n.items);
        if (n.key) fn(n.key);
        visitExpressions(n.children, fn);
        break;
      case 'include':
      case 'choice':
        if (n.props) fn(n.props);
        if (n.type === 'choice') visitExpressions(n.children, fn);
        break;
      case 'extension':
        Object.values(n.bindings).forEach(fn);
        visitExpressions(n.children, fn);
        break;
      case 'invoke':
        n.args.forEach(fn);
        visitExpressions(n.children, fn);
        break;
      case 'content':
      case 'button':
      case 'region':
      case 'region-change':
      case 'portal':
        visitExpressions(n.children, fn);
        break;
      case 'interaction':
        visitExpressions(n.label, fn);
        visitExpressions(n.children, fn);
        break;
      case 'control':
        fn(n.value);
        n.options.forEach(fn);
        visitExpressions(n.label, fn);
        break;
      case 'effect':
      case 'text':
        break;
    }
  }
}
