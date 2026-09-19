import { invariant } from './errors.js';
import { evaluateExpression } from './expression-runtime.js';
import { safeKey } from './json.js';
import type { Statement } from './ir.js';
import type { EvaluationContext, Scope } from './view.js';

/** Execute Gneh effect control flow; expression semantics belong to pure-expr. */
export function executeStatements(statements: Statement[], ctx: EvaluationContext, scope: Scope): void {
  invariant(ctx.phase !== 'render', 'E_PURITY', 'Statements require an enter/action context.');
  for (const statement of statements) {
    ctx.step();
    switch (statement.type) {
      case 'expression':
        evaluateExpression(statement.expression, ctx, scope);
        break;
      case 'declare':
        scope[safeKey(statement.name)] = evaluateExpression(statement.value, ctx, scope);
        break;
      case 'if':
        executeStatements(evaluateExpression(statement.test, ctx, scope) ? statement.yes : statement.no, ctx, scope);
        break;
      case 'each': {
        const items = evaluateExpression(statement.items, ctx, scope);
        invariant(Array.isArray(items), 'E_ITERABLE', 'Loop requires an array.');
        for (const item of items) executeStatements(statement.body, ctx, { ...scope, [statement.name]: item });
        break;
      }
    }
  }
}
