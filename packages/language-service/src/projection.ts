import { printBinding, printExpression } from '@gneh/compiler';
import type { EffectNode, Expression, PassageIR, Span, State, StoryNode } from '@gneh/core';
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
  if (name.startsWith('_')) return name.slice(1);
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
        case 'invoke':
          return `${effectName(effect.name)}(${effect.args.map(print).join(',')});`;
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
  let code = `export {};\ntype State = ${stateTypes ?? inferType(state)};\ndeclare let state: State;\ndeclare let value: unknown;\ndeclare function display(value: string|number|boolean|null|undefined): void;\ndeclare function contains(container: unknown, value: unknown): boolean;\ndeclare function random(min:number,max:number):number;\ndeclare function either<T>(...values:T[]):T;\ndeclare function array<T>(...values:T[]):T[];\ndeclare function datamap(...values:unknown[]):Record<string,unknown>;\ndeclare function navigate(id:string,props?:object):void;\ndeclare function host(operation:string,...args:unknown[]):unknown;\n`;
  const mappings: ProjectionMapping[] = [];
  const emit = (text: string, source?: Span) => {
    const start = code.length;
    code += text;
    if (source) mappings.push({ start, end: code.length, source });
  };
  const emitExpression = (expression: Expression) => emit(typedExpression(expression.ast), expression.span);
  let effectNames = new Map<string, string>();
  let viewNames = new Map<string, string>();
  const emitEffectCall = (name: string, args: ExpressionNode[]) => {
    emit(`${effectNames.get(name) ?? '__missing_effect'}(`);
    args.forEach((argument, index) => {
      if (index) emit(',');
      emit(typedExpression(argument));
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
          emitEffectCall(node.action.name, node.action.args);
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
          emitEffectCall(node.action.name, node.action.args);
          emitNodes(node.label);
          break;
        case 'effect':
          emit(typedEffects(node.effects, (name) => effectNames.get(name) ?? '__missing_effect') + '\n', node.span);
          break;
        case 'view-call': {
          const view = viewNames.get(node.name);
          if (view) emit(`${view}(`);
          else emit('void([');
          node.args.forEach((expression, index) => {
            if (index) emit(',');
            emitExpression(expression);
          });
          emit(view ? ');\n' : ']);\n');
          emitNodes(node.children);
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
    effectNames = new Map(Object.keys(passage.effects).map((name, effectIndex) => [name, `__effect_${effectIndex}`]));
    viewNames = new Map(Object.keys(passage.views).map((name, viewIndex) => [name, `__view_${viewIndex}`]));
    emit(`function __passage${index}(){\n`);
    for (const binding of passage.imports) emit(`const ${binding.local}: any = undefined;\n`);
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
    for (const [name, expression] of Object.entries(passage.constants)) {
      emit(`const ${name}=`);
      emitExpression(expression);
      emit(';\n');
    }
    const resolveEffect = (name: string) => effectNames.get(name) ?? '__missing_effect';
    if (passage.enter.length) emit(typedEffects(passage.enter, resolveEffect) + '\n', passage.span);
    for (const action of Object.values(passage.effects)) {
      emit(`function ${resolveEffect(action.name)}(${action.params.map(typedParameter).join(',')}){\n`);
      emit(typedEffects(action.body, resolveEffect), action.span);
      emit('\n}\n');
    }
    for (const view of Object.values(passage.views)) {
      emit(
        `function ${viewNames.get(view.name)}(${view.params.map(typedParameter).join(',')}){\nconst children:unknown=undefined;\n`,
      );
      emitNodes(view.body);
      emit('}\n');
    }
    emitNodes(passage.body);
    emit('}\n');
  }
  return { code, mappings, version: '' };
}
