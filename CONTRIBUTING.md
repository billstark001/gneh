# Contributing

The supported toolchain is Node.js 22.16 or newer, pnpm 12, TypeScript 7, Oxlint, and Oxfmt.

```sh
pnpm install --no-frozen-lockfile
pnpm check
pnpm build:examples
pnpm test:browser
```

Commit the lockfile produced by pnpm when dependencies change. Do not report a command as passing unless it was actually run. Local logs, screenshots, and ad-hoc reports belong in `verification/`, which is intentionally ignored by Git.

End-to-end language behavior belongs in `packages/conformance/cases/*.md`; parser, CST, diagnostic, emitter, and runtime-kernel tests remain with their owning packages. The local Oxlint rule `gneh/multiline-test-string` warns when a test fixture hides two or more line breaks behind JavaScript string escapes and safely fixes eligible fixtures to multiline template literals. Prefer named module-level fixture constants when one source is reused or substantial.

## Boundary rules

- `core` must not import a parser, DOM implementation, Vite, or an application shell.
- `source` owns source containers and metadata, not language semantics.
- `syntax` owns dialect-neutral scanning. It must not select an expression grammar or recognize a concrete dialect directive.
- Each dialect package owns its surface syntax and lowers directly to shared IR. It must not own a private story runtime.
- `runtime` consumes Fragments and semantic views; renderers consume views; an application or generated template owns layout, routing controls and styling.
- Vite owns web serving, asset graphs and production web builds. CLI file I/O must not leak into compiler packages or grow a second frontend build system.
- The Vite plugin must not claim generic `.md`, `.twee`, or framework files without an explicit `?gneh` request.

When adding an IR node, define its source span and observable semantics before adding interpreter, emitter, and renderer behavior. Expression changes require interpreter-versus-generated-code tests. Runtime lifecycle changes require action, undo, load, and dispose tests. Parser changes require nested delimiters, strings, code fences, and explicit unsupported diagnostics.

Never silently accept an incompatible legacy macro as prose. Update `docs/LANGUAGE.md` when the portable profile changes.

## Generated outputs

`pnpm build` runs these stages in order:

1. clean reproducible build outputs;
2. build ESM packages with TypeScript;
3. build browser bundles with `scripts/bundle.mjs`;
4. derive `standalone/` with `scripts/standalone.mjs`.

`pnpm build:examples` delegates to the package scripts owned by the three projects in `examples/` and the editable starter. Their `dist/` directories are generated; the example directories themselves are source. See `docs/GENERATED_ARTIFACTS.md` before changing the pipeline.

## Offline fallback

`build:offline` is an emergency path for a machine that already has the classic TypeScript compiler API installed. It does not replace the TypeScript 7 check.

```sh
GNEH_TYPESCRIPT_API=/path/to/typescript-package \
pnpm build:offline
```

Do not distribute `node_modules`, `.tsbuildinfo`, machine paths, `verification/`, or other local output.

## Browser and compatibility tests

```sh
pnpm build
pnpm test:browser
```

`test:browser` rebuilds both the workspace and the independently owned Vite examples before launching the suite. It uses `puppeteer-core` and a system Chrome/Chromium. Set `GNEH_CHROMIUM` when automatic discovery is insufficient.

External compiled Twine samples may be placed in a sibling `gneh-ws` directory and audited without copying them into the repository:

```sh
pnpm audit:samples
```

Use `GNEH_SAMPLE_DIR` to select another corpus. Compatibility audit percentages are diagnostic data, not a promise to emulate project-specific widgets or macros.
