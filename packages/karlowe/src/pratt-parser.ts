/** ALTERED SOURCE: adapted from twee-grind, commit a51c373c280f10d1448bb3bbbb51b60a39b09349,
 * packages/harlowe-markup/src/utils/pratt-parser.ts.
 * Copyright (c) 2024 Leon Arnott; (c) 2025 Bill Toshiaki Stark.
 * See licenses/twee-grind-harlowe.txt. Changes: narrowed token values, explicit generic leaf
 * creation and compact API; no interpreter code is included. */
export type PrattToken<T> =
  | {
      type: 'opr';
      value: string;
      start?: number;
      end?: number;
    }
  | {
      type: 'expr';
      value: T;
      start?: number;
      end?: number;
    };

export type PrattASTNode<T> =
  | {
      type: 'missing';
    }
  | {
      type: 'leaf';
      value: T;
    }
  | {
      type: 'prefix';
      operator: string;
      operand: PrattASTNode<T>;
    }
  | {
      type: 'postfix';
      operator: string;
      operand: PrattASTNode<T>;
    }
  | {
      type: 'binary';
      operator: string;
      left: PrattASTNode<T>;
      right: PrattASTNode<T>;
    };

export interface OperatorConfig {
  precedence: number;
  prefixPrecedence?: number;
  associativity?: 'left' | 'right';
  prefix?: boolean;
  /** Accept this infix operator without a left operand for Harlowe's inferred `it`. */
  implicitLeft?: boolean;
  postfix?: boolean;
  infix?: boolean;
}

export class PrattParseError extends Error {
  constructor(
    message: string,
    public readonly token?: {
      start?: number;
      end?: number;
    },
  ) {
    super(message + (token?.start !== undefined ? ` at position ${token.start}-${token.end}` : ''));
    this.name = 'PrattParseError';
  }
}

export class PrattParser<T> {
  private readonly operators: ReadonlyMap<string, OperatorConfig>;
  private tokens: PrattToken<T>[] = [];
  private position = 0;
  constructor(config: { operators: Record<string, OperatorConfig> }) {
    this.operators = new Map(Object.entries(config.operators));
  }
  parse(tokens: PrattToken<T>[]): PrattASTNode<T> | undefined {
    if (tokens.length === 0) return undefined;
    this.tokens = tokens;
    this.position = 0;
    const result = this.parseExpression(0);
    if (this.hasNext()) {
      const remaining = this.peek()!;
      throw new PrattParseError(
        `Unexpected token after expression: '${remaining.type === 'opr' ? remaining.value : 'expression'}'`,
        remaining,
      );
    }
    return result;
  }
  private parseExpression(minPrecedence: number): PrattASTNode<T> {
    let left = this.parsePrefix();
    while (this.hasNext()) {
      const token = this.peek()!;
      if (token.type !== 'opr') break;
      const config = this.operators.get(token.value);
      if (!config) break;
      if (config.postfix && config.precedence >= minPrecedence) {
        this.advance();
        left = { type: 'postfix', operator: token.value, operand: left };
        continue;
      }
      if (config.infix && config.precedence >= minPrecedence) {
        this.advance();
        const nextMinPrecedence = config.associativity === 'right' ? config.precedence : config.precedence + 1;
        const right = this.parseExpression(nextMinPrecedence);
        left = { type: 'binary', operator: token.value, left, right };
        continue;
      }
      break;
    }
    return left;
  }
  private parsePrefix(): PrattASTNode<T> {
    const token = this.advance();
    if (!token) throw new PrattParseError('Unexpected end of input');
    if (token.type === 'expr') return { type: 'leaf', value: token.value };
    const config = this.operators.get(token.value);
    if (config?.implicitLeft)
      return {
        type: 'binary',
        operator: token.value,
        left: { type: 'missing' },
        right: this.parseExpression(config.precedence + 1),
      };
    if (!config || !config.prefix)
      throw new PrattParseError(`Unexpected operator '${token.value}' at prefix position`, token);
    return {
      type: 'prefix',
      operator: token.value,
      operand: this.parseExpression(config.prefixPrecedence ?? config.precedence),
    };
  }
  private peek(): PrattToken<T> | undefined {
    return this.tokens[this.position];
  }
  private advance(): PrattToken<T> | undefined {
    return this.tokens[this.position++];
  }
  private hasNext(): boolean {
    return this.position < this.tokens.length;
  }
}
