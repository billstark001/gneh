import { test } from 'vitest';
import assert from 'node:assert/strict';
import { parseConformance } from './spec.js';

const nestedFenceSpecification = `# Parser behavior

## Fences

### Nested Inkdown fence

\`\`\`\`inkdown
:: Start [start]
\`\`\`js
const value = true;
\`\`\`
\`\`\`\`

\`\`\`text
const value = true;
\`\`\`
`;

const missingSeparatorSpecification = `# Invalid

## Group

### First

\`\`\`inkdown
first
\`\`\`

\`\`\`text
first
\`\`\`

### Second

\`\`\`inkdown
second
\`\`\`

\`\`\`text
second
\`\`\`
`;

test('long outer fences preserve nested Inkdown Markdown fences', () => {
  const [item] = parseConformance(nestedFenceSpecification, 'nested.md');
  assert.equal(
    item.input,
    `:: Start [start]
\`\`\`js
const value = true;
\`\`\``,
  );
  assert.equal(item.output, 'const value = true;');
});

test('adjacent cases require an explicit long-hyphen separator', () => {
  assert.throws(() => parseConformance(missingSeparatorSpecification, 'invalid.md'), /separate cases with ----/);
});

test('operation sequences reject malformed or ambiguous steps', () => {
  const malformed = nestedFenceSpecification.replace(
    '### Nested Inkdown fence',
    `### Nested Inkdown fence

\`\`\`json
{ "steps": [{ "undo": true, "redo": true }] }
\`\`\``,
  );
  assert.throws(() => parseConformance(malformed, 'invalid-step.md'), /one valid operation/);
});
