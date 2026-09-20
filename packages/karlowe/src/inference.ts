import type { ExpressionNode } from '@gneh/expression';
import type { PrattASTNode } from './pratt-parser.js';

const comparisonOperators = new Set([
  'is',
  'is not',
  'is >',
  'is <',
  'is >=',
  'is <=',
  '>',
  '<',
  '>=',
  '<=',
  '!=',
  'contains',
  'does not contain',
  'is in',
  'is not in',
]);

type Node = PrattASTNode<ExpressionNode>;

type Comparison = Extract<Node, { type: 'binary' }>;

function firstComparison(node: Node): Comparison | undefined {
  if (node.type !== 'binary') return undefined;
  if (comparisonOperators.has(node.operator)) return node;
  if (node.operator !== 'and' && node.operator !== 'or') return undefined;
  return firstComparison(node.left) ?? firstComparison(node.right);
}

function inferredIt(node: Node): boolean {
  return (
    node.type === 'missing' || (node.type === 'leaf' && node.value.type === 'Identifier' && node.value.name === 'it')
  );
}

function supplyLeft(node: Node, value: Node): Node {
  if (node.type !== 'binary' || !comparisonOperators.has(node.operator) || !inferredIt(node.left)) return node;
  return { ...node, left: value };
}

function lastComparison(node: Node): Comparison | undefined {
  if (node.type !== 'binary') return undefined;
  if (comparisonOperators.has(node.operator)) return node;
  if (node.operator !== 'and' && node.operator !== 'or') return undefined;
  return lastComparison(node.right) ?? lastComparison(node.left);
}

function isDefinitelyNonBoolean(node: Node): boolean {
  if (node.type === 'prefix') return node.operator === '+' || node.operator === '-';
  if (node.type === 'binary')
    return !comparisonOperators.has(node.operator) && node.operator !== 'and' && node.operator !== 'or';
  if (node.type !== 'leaf') return false;
  if (node.value.type === 'Literal') return typeof node.value.value !== 'boolean';
  return ['ArrayExpression', 'ObjectExpression', 'TemplateLiteral'].includes(node.value.type);
}

/**
 * Harlowe infers `it` and the nearest comparison when an `and`/`or` operand is
 * visibly non-Boolean. Preserve the statically unambiguous cases in the Pratt
 * tree so lowering never turns `$n is 7 or 14` into `($n === 7) || 14`.
 * Unknown identifiers stay logical operands because their runtime type may be
 * Boolean (for example, `$hurt is $bleeding or $bandaged`).
 */
export function inferKarloweComparisons(node: Node): Node {
  if (node.type === 'missing') return node;
  if (node.type === 'prefix') return { ...node, operand: inferKarloweComparisons(node.operand) };
  if (node.type !== 'binary') return node;
  let left = inferKarloweComparisons(node.left);
  let right = inferKarloweComparisons(node.right);
  if (node.operator !== 'and' && node.operator !== 'or') return { ...node, left, right };

  const preceding = lastComparison(left);
  if (preceding && right.type === 'binary' && comparisonOperators.has(right.operator) && inferredIt(right.left))
    right = supplyLeft(right, preceding.left);
  else if (isDefinitelyNonBoolean(right) && preceding)
    right = { type: 'binary', operator: preceding.operator, left: preceding.left, right };
  else {
    const following = firstComparison(right);
    if (isDefinitelyNonBoolean(left) && following)
      left = { type: 'binary', operator: following.operator, left, right: following.right };
  }
  return { ...node, left, right };
}
