# @gneh/syntax

Dialect-neutral delimiters, document scanning, and passage lowering.

Callers provide an expression parser and any dialect-specific token reader.
This package does not recognize Inkdown directives, Karlowe macros, or Sugarcast
macros, and it does not provide compatibility aliases for those frontends. It does
provide the caller-owned generic `MacroLoweringRegistry` used by all three frontends.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

New gneh code is MIT licensed.
