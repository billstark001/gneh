# @gneh/runtime

Renderer-neutral story transactions, instances, history and regions.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

## Story lifecycle and limits

`new Story(input, options)` validates the initial route and state but starts lazily. `start()`, the first `view` read, `load()`, or `reset()` performs setup and the initial render; setup is not replayed by a later `view` read. `load()` rebuilds transient registrations and mounted frames from the supplied persistent snapshot. Region overrides, mounted locals, and native closures are intentionally not restored.

History defaults to 100 snapshots. Set `historyLimit` to `0` to disable undo and redo, or to a non-negative safe integer to choose another bound. `maxSteps` must be a positive safe integer and bounds each evaluation transaction. `seed` must be an unsigned 32-bit integer. Invalid or non-finite limit values are rejected instead of silently disabling their safeguards.

`save()` returns JSON for the current route, props, state, PRNG state, and bounded history. `load()` validates the JSON shape, story identity, routes, dense JSON arrays, and every snapshot before changing observable state. Failed loads roll the Story back to its prior state.

New gneh code is MIT licensed.
