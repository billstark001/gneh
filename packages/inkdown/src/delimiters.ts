import { balanced, type Balanced, type BalancedOptions } from '@gneh/syntax';

function skipDirective(source: string, index: number): number | undefined {
  if (source[index] !== '@') return;
  const head = /^@(?:if|each)\s*/.exec(source.slice(index));
  if (head) {
    const argument = index + head[0].length;
    if (source[argument] === '(') return balanced(source, argument).end;
  }
  const effect = /^@(?:enter|effect)\s*/.exec(source.slice(index));
  if (effect && source[index + effect[0].length] === '{') return balanced(source, index + effect[0].length).end;
  const declaration = /^@(action|view)\s+[\w-]+\s*/.exec(source.slice(index));
  if (!declaration) return;
  let body = index + declaration[0].length;
  if (source[body] === '(') body = balanced(source, body).end;
  while (/\s/.test(source[body] ?? '')) body++;
  if (source[body] !== '{') return;
  return declaration[1] === 'view' ? balancedMarkup(source, body).end : balanced(source, body).end;
}

const markupOptions: BalancedOptions = { mode: 'markup', skip: skipDirective };

/** Inkdown prose delimiter scanning with directive bodies treated atomically. */
export function balancedMarkup(source: string, index: number): Balanced {
  return balanced(source, index, markupOptions);
}
