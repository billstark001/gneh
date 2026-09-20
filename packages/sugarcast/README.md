# @gneh/sugarcast

Portable SugarCube-like frontend.

`sugarcastMarkup` owns SugarCube-compatible prose, list, heading, quote, continuation, comment, and code parsing. Sugarcast reuses only dialect-neutral scanning tools from `@gneh/syntax`.

`createSugarcastLowerings()` exposes trusted IR-lowering extensions. Portable source-defined `<<widget>>` declarations lower to view IR, while scripts, DOM macros and runtime `Macro.add` remain unsupported.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

This frontend is implemented directly against gneh's shared syntax and semantic IR.
