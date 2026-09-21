function escapedLineFeeds(raw) {
  let count = 0;
  for (let index = 0; index < raw.length; index++) {
    if (raw[index] !== '\\') continue;
    let end = index;
    while (raw[end] === '\\') end++;
    if (raw[end] === 'n' && (end - index) % 2 === 1) count++;
    index = end - 1;
  }
  return count;
}

function withFileLineFeeds(raw) {
  let replacement = '';
  for (let index = 0; index < raw.length;) {
    if (raw[index] !== '\\') {
      replacement += raw[index++];
      continue;
    }
    let end = index;
    while (raw[end] === '\\') end++;
    const count = end - index;
    if (raw[end] === 'n' && count % 2 === 1) {
      replacement += '\\'.repeat(count - 1) + '\n';
      index = end + 1;
    } else {
      replacement += raw.slice(index, end);
      index = end;
    }
  }
  return replacement;
}

const multilineTestString = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer multiline template literals for test fixtures with several escaped line breaks.',
    },
    schema: [],
    fixable: 'code',
    messages: {
      preferTemplate: 'Use a multiline template literal with file line breaks instead of {{count}} escaped newlines.',
    },
  },
  create(context) {
    const report = (node, count, replacement) => {
      if (count < 2) return;
      context.report({
        node,
        messageId: 'preferTemplate',
        data: { count },
        fix: replacement === undefined ? undefined : (fixer) => fixer.replaceText(node, replacement),
      });
    };
    return {
      Literal(node) {
        if (typeof node.value !== 'string' || node.value.includes('\r')) return;
        const raw = context.sourceCode.getText(node);
        const count = [...node.value.matchAll(/\n/g)].length;
        const replacement =
          raw.includes('`') || raw.includes('${') ? undefined : '`' + withFileLineFeeds(raw.slice(1, -1)) + '`';
        report(node, count, replacement);
      },
      TemplateLiteral(node) {
        const raw = context.sourceCode.getText(node);
        if (raw.includes('\\r')) return;
        const count = node.quasis.reduce((sum, quasi) => sum + escapedLineFeeds(quasi.value.raw), 0);
        report(node, count, withFileLineFeeds(raw));
      },
    };
  },
};

export default {
  meta: { name: 'gneh' },
  rules: { 'multiline-test-string': multilineTestString },
};
