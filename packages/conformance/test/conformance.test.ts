import { describe, test } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSource } from '../../compiler/dist/index.js';
import type { View } from '../../core/dist/index.js';
import { inkdown } from '../../inkdown/dist/index.js';
import { karlowe } from '../../karlowe/dist/index.js';
import { XMLRenderer, renderText } from '../../renderer-xml/dist/index.js';
import { Story } from '../../runtime/dist/index.js';
import { sugarcast } from '../../sugarcast/dist/index.js';
import { parseConformance, type ConformanceCase } from './spec.js';

const casesDirectory = fileURLToPath(new URL('../cases', import.meta.url));
const dialects = [inkdown(), karlowe(), sugarcast()];

function descendants(nodes: readonly View[]): View[] {
  return nodes.flatMap((node) => [node, ...descendants(node.children ?? [])]);
}

function runCase(item: ConformanceCase): string {
  const result = compileSource(item.input, `${path.basename(item.file, '.md')}.${item.dialect}`, {
    dialect: item.dialect,
    dialects,
    entry: item.options.entry,
    state: item.options.state,
  });
  const errors = result.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (errors.length) {
    assert.equal(item.options.expect?.error, true, 'Unexpected compiler diagnostics');
    assert.equal(item.projection, 'text', 'Expected failures use a text output fence');
    return errors.map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`).join('\n');
  }
  try {
    const story = new Story(result.story, { entry: item.options.entry, state: item.options.state }).start();
    const saves = new Map<string, string>();
    for (const step of item.options.steps ?? []) {
      if ('activate' in step) {
        const target = descendants(story.view).find(
          (node) => (node.kind === 'button' || node.kind === 'choice') && renderText([node]).trim() === step.activate,
        );
        assert.ok(target?.activate, `Missing interactive node ${JSON.stringify(step.activate)}`);
        target.activate();
      } else if ('change' in step) {
        const target = descendants(story.view).find(
          (node) => node.change && renderText([node]).trim() === step.change.target,
        );
        assert.ok(target?.change, `Missing input node ${JSON.stringify(step.change.target)}`);
        target.change(step.change.value);
      } else if ('navigate' in step) story.navigate(step.navigate.target, step.navigate.props);
      else if ('save' in step) saves.set(step.save, story.save());
      else if ('load' in step) {
        const save = saves.get(step.load);
        assert.ok(save, `Missing save ${JSON.stringify(step.load)}`);
        story.load(save);
      } else if ('reset' in step) story.reset();
      else if ('undo' in step) assert.equal(story.undo(), true, 'Nothing to undo');
      else assert.equal(story.redo(), true, 'Nothing to redo');
    }
    assert.notEqual(item.options.expect?.error, true, 'Expected the case to fail');
    if (item.options.expect?.state) assert.deepEqual({ ...story.state }, item.options.expect.state);
    if (item.options.expect?.current) assert.equal(story.current, item.options.expect.current);
    if (item.options.expect?.registrations)
      assert.deepEqual([...story.registrations.keys()].sort(), [...item.options.expect.registrations].sort());
    if (item.options.expect?.canUndo !== undefined) assert.equal(story.canUndo, item.options.expect.canUndo);
    if (item.options.expect?.canRedo !== undefined) assert.equal(story.canRedo, item.options.expect.canRedo);
    return item.projection === 'xml' ? new XMLRenderer().render(story.view) : renderText(story.view);
  } catch (error) {
    if (item.options.expect?.error !== true) throw error;
    assert.equal(item.projection, 'text', 'Expected failures use a text output fence');
    return error instanceof Error ? error.message : String(error);
  }
}

const files = (await fs.readdir(casesDirectory)).filter((file) => file.endsWith('.md')).sort();
for (const file of files) {
  const source = await fs.readFile(path.join(casesDirectory, file), 'utf8');
  const cases = parseConformance(source, file);
  describe(file, () => {
    for (const item of cases)
      test(`${item.group} > ${item.name}`, () => {
        assert.equal(runCase(item), item.output);
      });
  });
}
