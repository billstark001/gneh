import { test } from 'vitest';
import assert from 'node:assert/strict';
import { XMLRenderer, renderText, renderXML } from '../dist/index.js';

test('canonical XML sorts and JSON-encodes attributes', () => {
  assert.equal(
    renderXML([
      { kind: 'extension:panel', attrs: { z: 2, a: { y: true, x: 'v' } }, children: [{ kind: 'text', text: '<ok>' }] },
    ]),
    '<gneh><extension a="{&quot;x&quot;:&quot;v&quot;,&quot;y&quot;:true}" name="&quot;panel&quot;" z="2"><text>&lt;ok&gt;</text></extension></gneh>',
  );
});

test('harness callbacks have stable structural handles', () => {
  let activated = 0;
  let changed: unknown;
  const renderer = new XMLRenderer();
  const xml = renderer.render([
    { kind: 'button', key: 'go', activate: () => activated++ },
    { kind: 'control:select', key: 'pick', change: (value) => (changed = value) },
  ]);
  assert.match(xml, /activate:&quot;go&quot;|activate:go/);
  assert.deepEqual(renderer.handles(), ['activate:go', 'change:pick']);
  renderer.activate('activate:go');
  renderer.change('change:pick', 'A');
  assert.equal(activated, 1);
  assert.equal(changed, 'A');
  assert.equal(renderText([{ kind: 'paragraph', children: [{ kind: 'text', text: 'plain' }] }]), 'plain');
});

test('reserved structural attributes and callback identities cannot be overwritten', () => {
  assert.match(renderXML([{ kind: 'extension:panel', attrs: { name: 'spoofed' } }]), /name="&quot;panel&quot;"/);
  assert.throws(
    () =>
      new XMLRenderer().render([
        { kind: 'button', key: 'same', activate() {} },
        { kind: 'button', key: 'same', activate() {} },
      ]),
    /Duplicate callback handle/,
  );
});
