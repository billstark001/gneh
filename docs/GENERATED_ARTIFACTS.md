# Generated artifacts

Generated files are deliberately excluded from Git. Source changes belong in `packages/`, `examples/`, `scripts/`, tests, or documentation—not in the output directories below.

| Output | Inputs | Generator | Purpose |
| --- | --- | --- | --- |
| `packages/*/dist/` | `packages/*/src`, tsconfig files | `tsc -b` | ESM, declarations, source maps |
| `dist/` | vendor entries plus package source | `scripts/bundle.mjs` | Browser IIFE bundles |
| `standalone/` | package dist, package manifests, browser bundles, licenses | `scripts/standalone.mjs` | Dependency-free Node distribution |
| `examples/*/dist/` | each example's sources and package manifest | its Vite `build` script | Independently deployable example application |
| `packages/create/template/dist/` | editable starter sources | its `build` script | Starter Vite output used by browser conformance |
| `verification/` | any local audit or visual-QA command | Maintainer-selected commands | Unversioned evidence and scratch reports |

## Rebuild

```sh
pnpm build
pnpm build:examples
```

`pnpm build` cleans package dist directories, root `dist/`, `standalone/`, and the TypeScript build-info cache before rebuilding. It then runs the browser bundler and standalone derivation. The standalone generator uses a normal `node_modules/@gneh/*` graph and copies the ordinary emitted packages without rewriting imports. Copied manifests replace `workspace:*` ranges with the release version and omit workspace-only LSP, language service, and Vite dependencies.

`pnpm build:examples` delegates to the `build` script in each example package and the editable starter. No root demo tree or bespoke derivation format exists; every output stays beside the project that owns it.

## Verification is local by design

`verification/` is ignored at the repository root. A maintainer may place logs, screenshots, compatibility reports, or performance measurements there, but committed documentation must state commands and durable expectations rather than linking to a machine-specific result file.

The external `gneh-ws` corpus is also not copied into this repository. Run `pnpm audit:samples` to inspect a sibling corpus or set `GNEH_SAMPLE_DIR`.
