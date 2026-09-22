# @gneh/runtime

Renderer-neutral story transactions, instances, history and regions.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

## Story lifecycle and limits

`new Story(input, options)` validates the initial route and state but starts lazily. `start()`, the first `view` read, `load()`, or `reset()` performs setup and the initial render; setup is not replayed by a later `view` read. `load()` rebuilds transient registrations and mounted frames from the supplied persistent snapshot. JSON continuation locals, lexical slots, loop snapshots, and crossed suspension keys are restored; region overrides, native closures, and other non-JSON handles are reconstructed or discarded.

History defaults to 100 snapshots. Set `historyLimit` to `0` to disable undo and redo, or to a non-negative safe integer to choose another bound. `maxSteps` must be a positive safe integer and bounds each evaluation transaction. `seed` must be an unsigned 32-bit integer. Invalid or non-finite limit values are rejected instead of silently disabling their safeguards.

`save()` returns JSON for the current route, props, state, PRNG state, continuations, and bounded history. `load()` validates the JSON shape, story identity, routes, dense JSON arrays, and every snapshot before changing observable state. Failed loads roll the Story back to its prior state.

Handwritten passages and views can return `v.flow(...)`. Its `v.lazy`, `v.step`, `v.suspend`, and keyed `v.each` instructions are evaluated only when their frontier is reached. `Story.advance()`, `signal()`, `tick()`, and `completeTask()` resume matching conditions. `flow.projection` selects `revealed` (default), `current`, or `all`; `all` is useful for wiki-style rendering without changing the authored flow.

New gneh code is MIT licensed.
