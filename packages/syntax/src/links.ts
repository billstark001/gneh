export type LinkSeparatorPolicy = 'source-order' | 'rightmost-arrow';

/**
 * Split the visible label and destination of a wiki link.
 *
 * The caller selects either the first separator in source order or the
 * rightmost arrow with a first-pipe fallback.
 */
export function splitWikiLink(
  source: string,
  policy: LinkSeparatorPolicy = 'rightmost-arrow',
): { label: string; target: string } {
  let delimiter: { value: '|' | '->' | '<-'; index: number } | undefined;
  if (policy === 'source-order') {
    for (const value of ['|', '->', '<-'] as const) {
      const index = source.indexOf(value);
      if (index >= 0 && (!delimiter || index < delimiter.index)) delimiter = { value, index };
    }
  } else {
    for (const value of ['->', '<-'] as const) {
      const index = source.lastIndexOf(value);
      if (index >= 0 && (!delimiter || index > delimiter.index)) delimiter = { value, index };
    }
    const pipe = source.indexOf('|');
    if (!delimiter && pipe >= 0) delimiter = { value: '|', index: pipe };
  }
  if (!delimiter) {
    const value = source.trim();
    return { label: value, target: value };
  }
  const left = source.slice(0, delimiter.index).trim();
  const right = source.slice(delimiter.index + delimiter.value.length).trim();
  return delimiter.value === '<-' ? { label: right, target: left } : { label: left, target: right };
}
