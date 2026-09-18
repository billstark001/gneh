# @gneh/cli

Story-domain command-line tools: diagnostics, metadata, graphing, migration, Twine
extraction/import, versioned structural inspection, formatting, LSP startup, and
optional non-Vite ESM emission.

The executable is declared with Commander, which owns argument validation, option
choices, help, and errors. Its internal Twine importer uses parse5 without imposing an
HTML dependency on source, compiler, or browser packages. Removed command forms are
not retained as aliases.

Frontend initialization and web builds belong to `@gneh/create` and Vite. This
package intentionally has no development server or HTML bundler.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

New gneh code is MIT licensed.
