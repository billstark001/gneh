import { printBinding, printExpression } from '@gneh/compiler';
import type { EffectNode, Expression, PassageIR, Span, State, StoryNode, ValueCallableBodyIR } from '@gneh/core';
import type { BindingPattern, ExpressionNode } from '@gneh/expression';

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
function typedIdentifier(name: string): string {
  if (name.startsWith('$')) return `state[${JSON.stringify(name.slice(1))}]`;
  return name;
}

function typedExpression(expression: ExpressionNode): string {
  return printExpression(expression, typedIdentifier);
}

function typedParameter(pattern: BindingPattern): string {
  if (pattern.type === 'Identifier') return `${typedIdentifier(pattern.name)}:any`;
  if (pattern.type === 'AssignmentPattern')
    return `${printBinding(pattern.left, typedIdentifier)}:any=${typedExpression(pattern.right)}`;
  if (pattern.type === 'RestElement') return `...${printBinding(pattern.argument, typedIdentifier)}:any[]`;
  return `${printBinding(pattern, typedIdentifier)}:any`;
}

function typedEffects(effects: EffectNode[], effectName: (name: string) => string = (name) => name): string {
  const print = typedExpression;
  return effects
    .map((effect) => {
      switch (effect.type) {
        case 'bind':
          return `let ${printBinding(effect.binding, typedIdentifier)}=${print(effect.value)};`;
        case 'expression':
          return `${print(effect.expression)};`;
        case 'if':
          return `if(${print(effect.test)}){${typedEffects(effect.yes, effectName)}}else{${typedEffects(effect.no, effectName)}}`;
        case 'each':
          return `for(const ${printBinding(effect.binding, typedIdentifier)} of ${print(effect.items)}){${typedEffects(effect.body, effectName)}}`;
        case 'call':
          return effect.call.callee.type === 'binding'
            ? `${effectName(effect.call.callee.name)}(${effect.call.args.map((argument) => print(argument.ast)).join(',')});`
            : `${effect.call.args.map((argument) => `void(${print(argument.ast)});`).join('')}`;
        case 'assign-callable':
          return `void(${print(effect.target)});`;
      }
    })
    .join('\n');
}

/**
 * Project passage expressions into one TypeScript file per source document.
 * The projection deliberately stubs imported runtime values as `any`: module checking
 * belongs to the real ESM/Vite project, while this layer checks portable story code.
 */
export function createVirtualFile(
  passages: PassageIR[],
  state: State,
  stateTypes?: string,
  bindings: readonly string[] = [],
): VirtualFile {
  let code = `export {};\ntype State = ${stateTypes ?? inferType(state)};\ndeclare let state: State;\ndeclare let value: unknown;\ndeclare function display(value: string|number|boolean|null|undefined): void;\ndeclare function contains(container: unknown, value: unknown): boolean;\ndeclare function random(min:number,max:number):number;\ndeclare function either<T>(...values:T[]):T;\ndeclare function array<T>(...values:T[]):T[];\ndeclare function datamap(...values:unknown[]):Record<string,unknown>;\ndeclare function navigate(id:string,props?:object):void;\ndeclare function host(operation:string,...args:unknown[]):unknown;\ndeclare function __missing_effect(...args:any[]):void;\n`;
  for (const name of bindings) code += `declare const ${name}:any;\n`;
  const mappings: ProjectionMapping[] = [];
  const emit = (text: string, source?: Span) => {
    const start = code.length;
    code += text;
    if (source) mappings.push({ start, end: code.length, source });
  };
  const emitExpression = (expression: Expression) => emit(typedExpression(expression.ast), expression.span);
  let effectNames = new Map<string, string>();
  let viewNames = new Map<string, string>();
  let callableSerial = 0;
  const emitEffectCall = (call: Extract<StoryNode, { type: 'button' }>['action']) => {
    const name = call.callee.type === 'binding' ? call.callee.name : '';
    emit(`${effectNames.get(name) ?? '__missing_effect'}(`);
    call.args.forEach((argument, index) => {
      if (index) emit(',');
      emitExpression(argument);
    });
    emit(');\n');
  };
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
        case 'region':
        case 'region-change':
        case 'portal':
          emitNodes(node.children);
          break;
        case 'button':
          emitEffectCall(node.action);
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
          emitEffectCall(node.action);
          emitNodes(node.label);
          break;
        case 'effect':
          emit(typedEffects(node.effects, (name) => effectNames.get(name) ?? '__missing_effect') + '\n', node.span);
          break;
        case 'call': {
          const name = node.call.callee.type === 'binding' ? node.call.callee.name : '';
          const view = viewNames.get(name);
          if (view) emit(`${view}(`);
          else emit('void([');
          node.call.args.forEach((expression, index) => {
            if (index) emit(',');
            emitExpression(expression);
          });
          emit(view ? ');\n' : ']);\n');
          emitNodes(node.children);
          break;
        }
        case 'callable': {
          const callable = node.callable;
          const name = `__callable_${callableSerial++}`;
          emit(`function ${name}(${callable.params.map(typedParameter).join(',')}){\n`);
          if (callable.phase === 'effect')
            emit(
              typedEffects(callable.body as EffectNode[], (binding) => effectNames.get(binding) ?? '__missing_effect'),
            );
          else if (callable.phase === 'view') {
            emit('const children:unknown=undefined;\n');
            emitNodes(callable.body as StoryNode[]);
          } else {
            const body = callable.body as ValueCallableBodyIR;
            emit(typedEffects(body.effects, (binding) => effectNames.get(binding) ?? '__missing_effect'));
            emit('\nreturn ');
            emitExpression(body.result);
            emit(';\n');
          }
          emit('}\n');
          break;
        }
        case 'children':
          emit('void(children);\n');
          break;
        case 'text':
          break;
      }
    }
  };

  for (let index = 0; index < passages.length; index++) {
    const passage = passages[index];
    const declarations = passage.body
      .filter((node): node is Extract<StoryNode, { type: 'callable' }> => node.type === 'callable')
      .map((node) => node.callable)
      .filter((callable) => callable.name);
    effectNames = new Map(
      declarations
        .filter((callable) => callable.phase === 'effect')
        .map((callable, effectIndex) => [callable.name!, `__effect_${effectIndex}`]),
    );
    viewNames = new Map(
      declarations
        .filter((callable) => callable.phase === 'view')
        .map((callable, viewIndex) => [callable.name!, `__view_${viewIndex}`]),
    );
    emit(`function __passage${index}(){\n`);
    emit('let props = {} as Record<string,unknown>;\n');
    for (const [name, expression] of Object.entries(passage.constants)) {
      emit(`const ${name}=`);
      emitExpression(expression);
      emit(';\n');
    }
    const resolveEffect = (name: string) => effectNames.get(name) ?? '__missing_effect';
    for (const action of declarations.filter((callable) => callable.phase === 'effect')) {
      emit(`function ${resolveEffect(action.name!)}(${action.params.map(typedParameter).join(',')}){\n`);
      emit(typedEffects(action.body as EffectNode[], resolveEffect), action.span);
      emit('\n}\n');
    }
    for (const view of declarations.filter((callable) => callable.phase === 'view')) {
      emit(
        `function ${viewNames.get(view.name!)}(${view.params.map(typedParameter).join(',')}){\nconst children:unknown=undefined;\n`,
      );
      emitNodes(view.body as StoryNode[]);
      emit('}\n');
    }
    emitNodes(passage.body);
    emit('}\n');
  }
  return { code, mappings, version: '' };
}
