/** Static include/navigation graph extraction. */
import type { PassageIR } from '@gneh/core';
import { walkNodes } from './project.js';

export function graph(passages: PassageIR[]): {
  from: string;
  to: string;
  kind: 'include' | 'choice';
}[] {
  const edges: {
    from: string;
    to: string;
    kind: 'include' | 'choice';
  }[] = [];
  for (const p of passages)
    walkNodes(p.body, (n) => {
      if (n.type === 'include' || n.type === 'choice') edges.push({ from: p.id, to: n.target, kind: n.type });
    });
  return edges;
}
