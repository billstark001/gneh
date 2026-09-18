/** A half-open UTF-16 source range, matching TypeScript/LSP offsets. */
export interface Span {
  file: string;
  start: number;
  end: number;
}

export interface Diagnostic {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  span: Span;
  hint?: string;
}

/** An expected, user-facing failure carrying a stable diagnostic code. */
export class GnehError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly span?: Span,
  ) {
    super(message);
    this.name = 'GnehError';
  }
}

export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new GnehError(code, message);
}
