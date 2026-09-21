interface CSTDiagnostic {
  code: string;
  message: string;
  start: number;
  end: number;
}

export const maxSugarcastCSTDepth = 128;

/** Preserve an over-deep CST region as lossless text while reporting the structural budget. */
export function cstDepthFallback(source: string, start: number, end: number, diagnostics: CSTDiagnostic[]) {
  diagnostics.push({
    code: 'SUGARCAST_CST_DEPTH',
    message: `Sugarcast macro nesting exceeds the CST depth limit of ${maxSugarcastCSTDepth}.`,
    start,
    end,
  });
  return end > start ? [{ type: 'text' as const, value: source.slice(start, end), start, end }] : [];
}
