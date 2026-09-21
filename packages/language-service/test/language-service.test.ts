import { test } from 'vitest';
import assert from 'node:assert/strict';

let Service;

try {
  ({ GnehLanguageService: Service } = await import('../dist/index.js'));
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
}

const options = {
  skip: !Service ? 'Workspace TypeScript language-service dependency is not installed.' : false,
};

test('TypeScript diagnostics flow back to all three source dialects', options, () => {
  const service = new Service({ state: { hp: 3 } });
  try {
    service.setDocument('/test/a.inkdown', ':: Ink\n{{ $hpp }}');
    service.setDocument('/test/b.karlowe', ':: Karl\n(print: $hpp)');
    service.setDocument('/test/c.sugarcast', ':: Sugar\n<<print $hpp>>');
    const diagnostics = service.diagnostics().filter((d) => d.code.startsWith('TS'));
    assert.equal(new Set(diagnostics.map((d) => d.span.file)).size, 3);
    assert.ok(diagnostics.every((d) => /hpp/.test(d.message)));
  } finally {
    service.dispose();
  }
});

test('state completion and hover use concrete project types', options, () => {
  const service = new Service({ state: { hp: 3, player: { name: 'Ada', level: 1 } } });
  try {
    const source = ':: Start\n$hp\n{{ $player.name }}';
    service.setDocument('/test/source.inkdown', source);
    assert.match(service.hover('/test/source.inkdown', source.indexOf('$hp') + 1).contents, /number/);
    service.setDocument('/test/edit.inkdown', ':: Edit\n{{ $player.');
    const result = service.completions('/test/edit.inkdown', ':: Edit\n{{ $player.'.length);
    assert.deepEqual(result.map((x) => x.label).sort(), ['level', 'name']);
  } finally {
    service.dispose();
  }
});

test('prop types and loop locals participate in semantic diagnostics', options, () => {
  const service = new Service({ state: { items: [{ name: 'Ada' }] } });
  try {
    service.setDocument(
      '/test/source.inkdown',
      ":: Start\n@each (item of $items; key item.name) {\n{{ item.missing }}\n}\n:: Card\n---\nparams: [enemy]\nparamTypes:\n  enemy: '{hp: number}'\n---\n{{ enemy.hpp }}",
    );
    const d = service.diagnostics().filter((d) => d.code.startsWith('TS'));
    assert.equal(d.length, 2);
    assert.ok(d.some((d) => d.message.includes('missing')));
    assert.ok(d.some((d) => d.message.includes('hpp')));
  } finally {
    service.dispose();
  }
});

test('cross-file definition, references and conservative rename are AST-based', options, () => {
  const service = new Service();
  try {
    const a = ':: Start\n[[Go -> End]]\n\nThe prose mentions End.';
    const b = ':: End\nFinish';
    service.setDocument('/test/a.inkdown', a);
    service.setDocument('/test/b.karlowe', b);
    const offset = a.indexOf('-> End') + 4;
    const definition = service.definition('/test/a.inkdown', offset);
    assert.equal(definition.file, '/test/b.karlowe');
    const edits = service.rename('/test/a.inkdown', offset, 'Final');
    assert.equal(edits.length, 2);
    assert.equal(service.references('/test/a.inkdown', offset).length, 1);
    assert.ok(!edits.some((e) => e.span.start === a.lastIndexOf('End.')));
  } finally {
    service.dispose();
  }
});

test('virtual files are inspectable and invalidate on edit', options, () => {
  const service = new Service({ state: { hp: 1 } });
  try {
    service.setDocument('/test/edit.md', ':: Start\n$bad');
    assert.ok(service.diagnostics().some((d) => d.code.startsWith('TS')));
    service.setDocument('/test/edit.md', ':: Start\n$hp');
    assert.deepEqual(service.diagnostics(), []);
    assert.match(service.virtualDocument('/test/edit.md'), /state\["hp"\]/);
  } finally {
    service.dispose();
  }
});

test('document symbols include actions and reusable views', options, () => {
  const service = new Service();
  try {
    const file = '/test/symbols.inkdown';
    service.setDocument(file, ':: Start\n@action save { @do $saved = true; }\n@view Badge(label) { {{ label }} }');
    assert.deepEqual(
      service.symbols(file).map(({ name, kind }) => ({ name, kind })),
      [
        { name: 'Start', kind: 'fragment' },
        { name: 'save', kind: 'action' },
        { name: 'Badge', kind: 'view' },
      ],
    );
  } finally {
    service.dispose();
  }
});

test('nested callable bodies participate in semantic diagnostics', options, () => {
  const service = new Service({ state: { hp: 1 } });
  try {
    service.setDocument('/test/nested.inkdown', '@if (true) { @view Local() { {{ $hpp }} } @Local() }');
    const diagnostics = service.diagnostics().filter((diagnostic) => diagnostic.code.startsWith('TS'));
    assert.ok(diagnostics.some((diagnostic) => /hpp/.test(diagnostic.message)));
  } finally {
    service.dispose();
  }
});
