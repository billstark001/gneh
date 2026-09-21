import type { BindingPattern, Diagnostic, ImportIR, ParseResult } from '@gneh/core';

function bindingNames(pattern: BindingPattern): string[] {
  switch (pattern.type) {
    case 'Identifier':
      return [pattern.name];
    case 'AssignmentPattern':
      return bindingNames(pattern.left);
    case 'RestElement':
      return bindingNames(pattern.argument);
    case 'ArrayPattern':
      return pattern.elements.flatMap((item) => (item ? bindingNames(item) : []));
    case 'ObjectPattern':
      return pattern.properties.flatMap((item) =>
        item.type === 'RestElement' ? bindingNames(item) : bindingNames(item.value),
      );
  }
}

/** Validate names that become real ESM bindings before code generation. */
export function validateModuleLinkage(parsed: ParseResult, source: string, file: string): void {
  const importNames = new Map<string, ImportIR>();
  const report = (diagnostic: Omit<Diagnostic, 'severity'>) =>
    parsed.diagnostics.push({ ...diagnostic, severity: 'error' });
  for (const binding of parsed.module?.imports ?? []) {
    const previous = importNames.get(binding.local);
    if (previous && (previous.source !== binding.source || previous.imported !== binding.imported))
      report({
        code: 'IMPORT_CONFLICT',
        message: `Import name ${binding.local} refers to both ${previous.source}:${previous.imported} and ${binding.source}:${binding.imported}.`,
        span: { file, start: 0, end: Math.min(source.length, 3) },
      });
    importNames.set(binding.local, binding);
  }
  const direct = new Set<string>();
  const generatedNames = new Set(['passages', '__gneh', '__sets', '__init', '__bindings', '__primary', '__primaryIR']);
  for (const node of parsed.module?.primary?.body ?? []) {
    const names =
      node.type === 'callable' && node.callable.name
        ? [node.callable.name]
        : node.type === 'effect'
          ? node.effects.flatMap((effect) => {
              if (effect.type === 'bind') return bindingNames(effect.binding);
              if (
                effect.type === 'expression' &&
                effect.expression.type === 'AssignmentExpression' &&
                effect.expression.operator === '=' &&
                effect.expression.left.type === 'Identifier' &&
                effect.expression.left.name.startsWith('_')
              )
                return [effect.expression.left.name];
              return [];
            })
          : [];
    for (const name of names) {
      if (name.startsWith('$'))
        report({
          code: 'PRIMARY_STATE',
          message: 'Primary declarations cannot bind Story state.',
          span: node.span,
        });
      if (direct.has(name))
        report({ code: 'DUPLICATE_BINDING', message: `Duplicate primary binding: ${name}`, span: node.span });
      if (importNames.has(name))
        report({ code: 'IMPORT_SHADOW', message: `Primary binding shadows import: ${name}`, span: node.span });
      direct.add(name);
    }
  }
  for (const binding of parsed.module?.imports ?? [])
    if (generatedNames.has(binding.local) || /^__(?:ir|p)\d+$/.test(binding.local))
      report({
        code: 'MODULE_RESERVED',
        message: `Import binding is reserved by generated module linkage: ${binding.local}`,
        span: { file, start: 0, end: Math.min(source.length, 3) },
      });
  for (const item of parsed.module?.exports ?? []) {
    const span = parsed.module?.primary?.span ?? { file, start: 0, end: Math.min(source.length, 3) };
    if (generatedNames.has(item.local) || /^__(?:ir|p)\d+$/.test(item.local))
      report({
        code: 'MODULE_RESERVED',
        message: `Export binding is reserved by generated module linkage: ${item.local}`,
        span,
      });
    else if (!direct.has(item.local))
      report({
        code: 'EXPORT_UNKNOWN',
        message: `Exported binding is not definitely assigned in primary: ${item.local}`,
        span,
      });
  }
}
