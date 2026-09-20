# @gneh/inkdown

Inkdown directives, Markdown-style prose parsing, portable expressions, and frontend assembly.

`inkdownMarkup` owns Inkdown's inline and block grammar. `createInkdownLowerings()` returns the built-in, case-sensitive directive registry and can be extended without process-global mutation.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

New gneh code is MIT licensed.
