# @gneh/karlowe

Portable Karlowe frontend with a new span-preserving lexer and an attributed Pratt
expression parser.

Karlowe shares dialect-neutral scanning tools with the other frontends but does not
recognize Inkdown directives.

`createKarloweLowerings()` exposes trusted IR-lowering extensions. Its lookup is
ASCII-case-insensitive and ignores internal hyphens, matching Harlowe macro names.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

The markup lexer and parser are new gneh code. A small altered Pratt parser remains
attributed to twee-grind; see the root `THIRD_PARTY_NOTICES.md` and `licenses/`.
