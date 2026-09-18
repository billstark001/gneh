import type { Expression, Expr, PassageIR, Span, State, Statement, StoryNode } from '@gneh/core';

/** A generated range paired with the authoring-language range that produced it. */
export interface ProjectionMapping {
  start: number;
  end: number;
  source: Span;
}

/**
 * TypeScript sees this synthetic document; users keep editing the original dialect.
 * Mappings are intentionally expression-sized so diagnostics and hover information can
 * be translated without pretending that the generated control flow is user-authored.
 */
export interface VirtualFile {
  code: string;
  mappings: ProjectionMapping[];
  version: string;
}

export function inferType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `Array<${[...new Set(value.map(inferType))].join(' | ') || 'unknown'}>`;
  if (typeof value === 'object')
    return `{ ${Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => `${JSON.stringify(key)}: ${inferType(entry)}`)
      .join('; ')} }`;
  return ['number', 'boolean', 'string'].includes(typeof value) ? typeof value : 'unknown';
}

/** Render portable IR as type-checkable TypeScript, never as executable story code. */
function typedExpression(expression: Expr): string {
  const print = typedExpression;
  switch (expression.type) {
    case 'chain':
      return print(expression.value);
    case 'literal':
      return JSON.stringify(expression.value);
    case 'reference':
      if (expression.namespace === 'state') return `state[${JSON.stringify(expression.name)}]`;
      if (expression.namespace === 'props') return 'props';
      return expression.name;
    case 'array':
      return `[${expression.items.map(print).join(',')}]`;
    case 'object':
      return `{${expression.entries.map(([key, value]) => `${JSON.stringify(key)}:${print(value)}`).join(',')}}`;
    case 'unary':
      return `(${expression.op} ${print(expression.value)})`;
    case 'binary':
      return `(${print(expression.left)} ${expression.op} ${print(expression.right)})`;
    case 'conditional':
      return `(${print(expression.test)}?${print(expression.yes)}:${print(expression.no)})`;
    case 'get':
      return `${print(expression.object)}${expression.optional ? '?.' : ''}[${print(expression.key)}]`;
    case 'call':
      return `${print(expression.callee)}${expression.optional ? '?.' : ''}(${expression.args.map(print).join(',')})`;
    case 'arrow':
      return `(${expression.params.join(',')})=>(${print(expression.body)})`;
    case 'template':
      return (
        expression.parts
          .map((part) => (typeof part === 'string' ? JSON.stringify(part) : `String(${print(part)})`))
          .join(' + ') || '""'
      );
  }
}

function typedStatements(statements: Statement[]): string {
  const print = typedExpression;
  return statements
    .map((statement) => {
      switch (statement.type) {
        case 'assign':
          return `${print(statement.target)} ${statement.op} ${print(statement.value)};`;
        case 'declare':
          return `let ${statement.name}=${print(statement.value)};`;
        case 'call':
          return `${print(statement.expression)};`;
        case 'if':
          return `if(${print(statement.test)}){${typedStatements(statement.yes)}}else{${typedStatements(statement.no)}}`;
        case 'each':
          return `for(const ${statement.name} of ${print(statement.items)}){${typedStatements(statement.body)}}`;
      }
    })
    .join('\n');
}

/**
 * Project passage expressions into one TypeScript file per source document.
 * The projection deliberately stubs imported runtime values as `any`: module checking
 * belongs to the real ESM/Vite project, while this layer checks portable story code.
 */
export function createVirtualFile(passages: PassageIR[], state: State, stateTypes?: string): VirtualFile {
  let code = `export {};\ntype State = ${stateTypes ?? inferType(state)};\ndeclare let state: State;\ndeclare let value: unknown;\ndeclare function display(value: string|number|boolean|null|undefined): void;\ndeclare function contains(container: unknown, value: unknown): boolean;\ndeclare function random(min:number,max:number):number;\ndeclare function either<T>(...values:T[]):T;\ndeclare function array<T>(...values:T[]):T[];\ndeclare function datamap(...values:unknown[]):Record<string,unknown>;\ndeclare function navigate(id:string,props?:object):void;\ndeclare function host(operation:string,...args:unknown[]):unknown;\ndeclare function prompt(...args:unknown[]):unknown;\ndeclare function saveGame(...args:unknown[]):unknown;\ndeclare function loadGame(...args:unknown[]):unknown;\ndeclare function savedGames(...args:unknown[]):unknown;\ndeclare function history(...args:unknown[]):unknown;\n`;
  const mappings: ProjectionMapping[] = [];
  const emit = (text: string, source?: Span) => {
    const start = code.length;
    code += text;
    if (source) mappings.push({ start, end: code.length, source });
  };
  const emitExpression = (expression: Expression) => emit(typedExpression(expression.ast), expression.span);
  const emitNodes = (nodes: StoryNode[]) => {
    for (const node of nodes) {
      switch (node.type) {
        case 'value':
          emit('display(');
          emitExpression(node.expression);
          emit(');\n');
          break;
        case 'if':
          emit('if(');
          emitExpression(node.test);
          emit('){\n');
          emitNodes(node.yes);
          emit('}else{\n');
          emitNodes(node.no);
          emit('}\n');
          break;
        case 'each':
          emit(`for(const ${node.name} of `);
          emitExpression(node.items);
          emit('){\nconst index=0, _index=0;\n');
          if (node.key) {
            emit('void(');
            emitExpression(node.key);
            emit(');\n');
          }
          emitNodes(node.children);
          emit('}\n');
          break;
        case 'include':
        case 'choice':
          if (node.props) {
            emit('void(');
            emitExpression(node.props);
            emit(');\n');
          }
          if (node.type === 'choice') emitNodes(node.children);
          break;
        case 'extension':
          for (const expression of Object.values(node.bindings)) {
            emit('void(');
            emitExpression(expression);
            emit(');\n');
          }
          emitNodes(node.children);
          break;
        case 'invoke':
          for (const expression of node.args) {
            emit('void(');
            emitExpression(expression);
            emit(');\n');
          }
          emitNodes(node.children);
          break;
        case 'content':
        case 'button':
        case 'region':
        case 'region-change':
        case 'portal':
          emitNodes(node.children);
          break;
        case 'interaction':
          emitNodes(node.label);
          emitNodes(node.children);
          break;
        case 'control':
          emit('void(');
          emitExpression(node.value);
          emit(');\n');
          for (const option of node.options) {
            emit('void(');
            emitExpression(option);
            emit(');\n');
          }
          emitNodes(node.label);
          break;
        case 'effect':
          emit(typedStatements(node.statements) + '\n', node.span);
          break;
        case 'text':
          break;
      }
    }
  };

  for (let index = 0; index < passages.length; index++) {
    const passage = passages[index];
    emit(`function __passage${index}(){\n`);
    for (const name of passage.imports) emit(`const ${name}: any = undefined;\n`);
    const params = Array.isArray(passage.metadata.params)
      ? passage.metadata.params.filter((value): value is string => typeof value === 'string')
      : [];
    const types =
      passage.metadata.paramTypes &&
      typeof passage.metadata.paramTypes === 'object' &&
      !Array.isArray(passage.metadata.paramTypes)
        ? passage.metadata.paramTypes
        : {};
    const optional = Array.isArray(passage.metadata.optionalParams) ? passage.metadata.optionalParams : [];
    emit(
      `let props = {} as {${params
        .map(
          (name) =>
            `${JSON.stringify(name)}${optional.includes(name) ? '?' : ''}:${typeof types[name] === 'string' ? types[name] : 'unknown'}`,
        )
        .join(';')}};\n`,
    );
    for (const name of params) if (/^[a-zA-Z_][\w]*$/.test(name)) emit(`let ${name}=props[${JSON.stringify(name)}];\n`);
    if (passage.enter.length) emit(typedStatements(passage.enter) + '\n', passage.span);
    for (const action of Object.values(passage.actions)) {
      emit(`function __action_${action.name.replace(/\W/g, '_')}(){\n`);
      emit(typedStatements(action.statements), action.span);
      emit('\n}\n');
    }
    emitNodes(passage.body);
    emit('}\n');
  }
  return { code, mappings, version: '' };
}
