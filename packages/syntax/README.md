# @gneh/syntax

Dialect-neutral delimiter scanning, parser context, list construction, and passage lowering.

Callers provide an expression parser plus a `MarkupDialect` containing their inline and block readers. This package owns recursion limits, source spans, declaration collection, and common link/value dispatch; it contains no concrete dialect profile. It also provides the caller-owned generic `MacroLoweringRegistry` used by all three frontends.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

New gneh code is MIT licensed.
