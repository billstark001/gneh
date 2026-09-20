# 0001: Keep story composition in the application entry

Status: accepted

## Context

An earlier Vite integration exposed a virtual project module which scanned a directory, selected story files, merged their exports, and chose a project entry implicitly. That design was removed once before and briefly reconsidered during the 0.1 toolchain cleanup.

The virtual module hid the application module graph, made inclusion depend on filesystem discovery, coupled project configuration to a build-tool-only identifier, and made it unclear where project-scoped JavaScript, JSON data, runtime extensions, and initial state belonged. It also made ordinary TypeScript resolution and non-Vite tools observe a different graph from Vite.

## Decision

Application JavaScript or TypeScript explicitly imports every story module it uses and combines their `fragments` exports. Project-scoped JavaScript and JSON are imported by that same application entry. The Vite plugin only transforms explicitly imported authoring files and never scans for or aggregates a project behind a virtual alias.

Every dialect is registered explicitly in `vite.config.ts`, including Inkdown. Registered dialects determine which file extensions the plugin claims; registration does not select application modules.

## Consequences

- The source entry is the complete, inspectable project module graph.
- TypeScript, Vite, tests, and alternative bundlers see the same imports.
- Adding a story file does not silently ship it.
- Multi-file applications perform an explicit merge, for example `Object.values({ ...chapterOne, ...chapterTwo })`.
- `virtual:gneh/project`, implicit story-directory scanning, and config-file aliases are not public APIs and must not be reintroduced.
