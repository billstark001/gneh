# 0001: Prefer explicit project composition

Status: accepted

## Context

An earlier Vite integration exposed a virtual project module which scanned a directory, selected story files, merged their exports, and chose a project entry implicitly. That design was removed once before and briefly reconsidered during the 0.1 toolchain cleanup.

The virtual module hid the application module graph, made inclusion depend on filesystem discovery, coupled project configuration to a build-tool-only identifier, and made it unclear where project-scoped JavaScript, JSON data, runtime extensions, and initial state belonged. It also made ordinary TypeScript resolution and non-Vite tools observe a different graph from Vite.

This is not only a virtual-module concern. The same trade-off appears in dialect registration, configuration discovery, runtime setup, generated files, story aggregation, and framework integration. Hidden behavior in any of these layers can make a project easier to start but harder to inspect, extend, or use outside the tool which supplied that behavior.

## Decision

GNEH prefers explicit project composition over hidden project behavior. Public APIs and project source should make ownership, module boundaries, inclusion, ordering, and configuration visible wherever those choices can materially change the application.

Implicit defaults are acceptable when they follow a common mental model and remain local, deterministic, documented, observable, and easy to override. A sensible default value or an unambiguous local convention can reduce boilerplate; silently discovering project files, changing the module graph, or selecting project behavior from unrelated filesystem state does not meet that standard.

For the current Vite integration, application JavaScript or TypeScript explicitly imports every story module it uses and combines their `fragments` exports. Project-scoped JavaScript and JSON are imported by that same application entry. The Vite plugin transforms explicitly imported authoring files and does not scan for or aggregate a project behind a virtual alias.

Every dialect is registered explicitly in `vite.config.ts`, including Inkdown. Registered dialects determine which file extensions the plugin claims; registration does not select application modules.

`virtual:gneh/project`, implicit story-directory scanning, and config-file aliases are therefore not part of the current public API. This records why that design was rejected; it does not rule out a future, explicitly specified bulk-composition API.

## Deferred questions

Bulk importing a large number of story files is a real problem. Requiring one handwritten import and merge per file is inspectable, but it does not scale well. A future design may provide an application-owned manifest or barrel, an explicit glob, dialect-level include syntax, or another bulk-import mechanism. It must define inclusion, ordering, diagnostics, tool portability, and override behavior before adoption instead of restoring project-wide discovery as an incidental Vite feature.

The distinction between a `passage` and `passages` also needs clarification. Today one Inkdown, Karlowe, or Sugarcast source file can define multiple passages and compile to one module whose `fragments` export is a collection. The source file is therefore neither exactly one passage nor the complete project passage set. At the same time, an authoring file cannot currently compose a passage set by importing several other authoring files, so file-local collections and project-level collections are easy to conflate.

Before adding cross-file composition to a dialect, the project should decide whether imports compose source files, compiled modules, passages, or passage collections; how names and collisions work; and whether the result belongs to dialect syntax, ordinary JavaScript or TypeScript, or a separate manifest. That discussion may justify a new explicit bulk API, but it should not make Vite the hidden owner of the project model.

## Consequences

- The source entry is the complete, inspectable project module graph.
- TypeScript, Vite, tests, and alternative bundlers see the same imports.
- Adding a story file does not silently ship it.
- Multi-file applications perform an explicit merge, for example `Object.values({ ...chapterOne, ...chapterTwo })`.
- Defaults remain available where they express an unsurprising local choice without concealing project composition.
- Large projects retain some import boilerplate until the bulk-import and passage-collection semantics are deliberately designed.
