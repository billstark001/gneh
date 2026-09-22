import { v } from '@gneh/core';
import { defineView } from '@gneh/runtime';

export const formulaDescription =
  'A handwritten defineView() emits a semantic extension node; a renderer-dom plugin owns the resulting DOM.';

const formulae = Object.freeze({
  confidence: String.raw`\mathcal{N}_i(t)=\{j:|x_j(t)-x_i(t)|\leq\varepsilon\}`,
  hk: String.raw`x_i(t+1)=\frac{1}{|\mathcal{N}_i(t)|}\sum_{j\in\mathcal{N}_i(t)}x_j(t)`,
  deffuant: String.raw`x_i'=x_i+\mu(x_j-x_i),\qquad x_j'=x_j+\mu(x_i-x_j)`,
  recommendation: String.raw`R(j\mid i,S_t)\geq0,\qquad\sum_{j\in\mathcal{C}_i(S_t)}R(j\mid i,S_t)=1`,
  density: String.raw`\rho(x,t)\geq0,\qquad\int\rho(x,t)\,\mathrm{d}x=1`,
  committor: String.raw`q(s)=\mathbb{P}_s(\tau_A<\tau_B)`,
});

export function formulaSource(id) {
  return formulae[id] ?? String(id);
}

/** @typedef {{ id: keyof typeof formulae; label?: string; display?: boolean }} FormulaProps */
export default defineView(
  /** @param {FormulaProps} props */
  (props) =>
    v.extension('latex', {
      source: formulaSource(props.id),
      label: props.label ?? 'Mathematical expression',
      display: props.display ?? true,
    }),
);
