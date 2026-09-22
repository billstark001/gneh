import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { Story, definePassage, definePassageSet, definePassages } from '../dist/index.js';
import { assert, text } from './helpers.js';

test('read-only state blocks meta-object mutations and keeps identity within one render', () => {
  let stableIdentity = false;
  const passage = definePassage({
    id: 'Readonly',
    render(ctx) {
      stableIdentity = ctx.state.player === ctx.state.player;
      return 'ok';
    },
  });
  const instance = new Story(definePassages(passage), {
    entry: 'Readonly',
    state: { player: { hp: 3 } },
  }).start();

  assert.equal(stableIdentity, true);
  assert.throws(() => Object.setPrototypeOf(instance.state.player, null), /read-only/i);
  assert.throws(() => Object.preventExtensions(instance.state.player), /read-only/i);
  assert.deepEqual(instance.state, { player: { hp: 3 } });
});

test('fragment contexts hide runtime internals and preserve render purity under tampering', () => {
  let ownKeys: string[] = [];
  let phaseWriteRejected = false;
  let stateWriteRejected = false;
  let leakedInternals: unknown[] = [];
  const passage = definePassage({
    id: 'EncapsulatedContext',
    render(ctx) {
      const untyped = ctx as unknown as Record<string, unknown>;
      ownKeys = Object.keys(ctx);
      leakedInternals = [untyped.story, untyped.frame, untyped.hooks, untyped.runtime];
      untyped.readonlyState = undefined;
      try {
        untyped.phase = 'enter';
      } catch {
        phaseWriteRejected = true;
      }
      try {
        ctx.state.changedDuringRender = true;
      } catch {
        stateWriteRejected = true;
      }
      return 'safe';
    },
  });
  const instance = new Story(definePassages(passage), {
    entry: 'EncapsulatedContext',
    state: { changedDuringRender: false },
  }).start();

  assert.deepEqual(ownKeys, []);
  assert.deepEqual(leakedInternals, [undefined, undefined, undefined, undefined]);
  assert.equal(phaseWriteRejected, true);
  assert.equal(stateWriteRejected, true);
  assert.equal(instance.state.changedDuringRender, false);
});

test('Story declarations do not expose FragmentContext implementation hooks', () => {
  const declaration = readFileSync(new URL('../dist/story/story.d.ts', import.meta.url), 'utf8');
  const contextDeclaration = readFileSync(new URL('../dist/story/context.d.ts', import.meta.url), 'utf8');
  const accidentalMembers = [
    'options',
    'identity',
    'unsafeMutableState',
    'registrySnapshot',
    'restoring',
    'suspended',
    'installSuspension',
    'updateRegion',
    'random',
    'step',
    'performNavigation',
    'include',
    'publish',
    'transact',
  ];

  for (const member of accidentalMembers) {
    const publicDeclaration = new RegExp(`^    (?!private\\b)(?:readonly )?(?:get )?${member}(?:\\(|:|;)`, 'm');
    assert.doesNotMatch(declaration, publicDeclaration, `${member} must not be part of Story's public type`);
  }
  assert.doesNotMatch(declaration, /from ['"]\.\/frames\.js['"]/, 'public Story types must not expose Frame');
  assert.doesNotMatch(contextDeclaration, /export declare class ContextRuntime\b/);
});

test('a failed load does not consume enter lifecycle on a lazy story', () => {
  let enters = 0;
  const passage = definePassage({
    id: 'LazyRollback',
    enter() {
      enters++;
    },
    render(ctx) {
      if (ctx.state.fail) throw new Error('load render failed');
      return 'ready';
    },
  });
  const passages = definePassages(passage);
  const source = new Story(passages, { entry: 'LazyRollback', state: { fail: false } }).start();
  const saved = JSON.parse(source.save());
  saved.present.state.fail = true;
  const target = new Story(passages, { entry: 'LazyRollback', state: { fail: false } });
  enters = 0;

  assert.throws(() => target.load(JSON.stringify(saved)), /load render failed/);
  assert.equal(enters, 0);
  target.start();
  assert.equal(enters, 1);
  assert.equal(text(target.view), 'ready');
});

test('a failed transaction restores state and reports the restore trace', () => {
  const traces: string[] = [];
  const passage = definePassage({
    id: 'TransactionRollback',
    render(ctx) {
      if (ctx.state.fail) throw new Error('transaction render failed');
      return 'ready';
    },
  });
  const instance = new Story(definePassages(passage), {
    entry: 'TransactionRollback',
    state: { fail: false },
    onTrace(event) {
      traces.push(event.type);
    },
  }).start();
  traces.length = 0;

  assert.throws(
    () =>
      instance.mutate((state) => {
        state.fail = true;
      }),
    /transaction render failed/,
  );
  assert.deepEqual(instance.state, { fail: false });
  assert.deepEqual(traces, ['render', 'restore']);
});

test('a setup frame is replaced only after the complete load succeeds', () => {
  let disposals = 0;
  const setup = definePassage({
    id: 'Setup',
    enter(ctx) {
      ctx.onDispose(() => disposals++);
    },
    render: () => [],
  });
  const passage = definePassage({
    id: 'StagedSetup',
    render(ctx) {
      if (ctx.state.fail) throw new Error('passage render failed');
      return 'ready';
    },
  });
  const instance = new Story(definePassageSet({ passages: [setup, passage], setup: [setup] }), {
    entry: 'StagedSetup',
    state: { fail: false },
  }).start();
  const saved = JSON.parse(instance.save());
  saved.present.state.fail = true;

  assert.throws(() => instance.load(JSON.stringify(saved)), /passage render failed/);
  assert.equal(disposals, 1, 'the staged replacement frame is disposed');
  assert.equal(text(instance.view), 'ready');
  instance.dispose();
  assert.equal(disposals, 2, 'the original frame survives until normal disposal');
});
