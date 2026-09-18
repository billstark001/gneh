# @gneh/sugarcast

Portable SugarCube-like frontend.

Sugarcast shares dialect-neutral scanning tools with the other frontends but does
not recognize Inkdown directives.

`createSugarcastLowerings()` exposes trusted IR-lowering extensions while
source-defined widgets, scripts, DOM macros and `Macro.add` remain unsupported.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

This frontend is implemented directly against gneh's shared syntax and semantic IR.
