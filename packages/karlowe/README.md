# @gneh/karlowe

Portable Karlowe frontend with a new span-preserving lexer and an attributed Pratt expression parser.

`karloweMarkup` owns Harlowe-compatible prose, list, heading, line-break, and verbatim parsing. Karlowe reuses only dialect-neutral scanning tools from `@gneh/syntax`.

`createKarloweLowerings()` exposes trusted IR-lowering extensions. Its lookup is ASCII-case-insensitive and ignores internal hyphens, matching Harlowe macro names.

Portable `(macro:)` values lower to story-captured value or view callables. Saves retain declaration references rather than JavaScript closure objects.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

The markup lexer and parser are new gneh code. A small altered Pratt parser remains attributed to twee-grind; see the root `THIRD_PARTY_NOTICES.md` and `licenses/`.
