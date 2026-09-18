# Generated artifacts

Generated files are deliberately excluded from Git. Source changes belong in `packages/`, `examples/`, `scripts/`, tests, or documentation—not in the output directories below.

| Output | Inputs | Generator | Purpose |
| --- | --- | --- | --- |
| `packages/*/dist/` | `packages/*/src`, tsconfig files | `tsc -b` | ESM, declarations, source maps |
| `dist/` | vendor entries plus package source | `scripts/bundle.mjs` | Browser IIFE bundles |
| `standalone/` | package dist, package manifests, browser bundles, licenses | `scripts/standalone.mjs` | Dependency-free Node distribution |
| `demo/` | `packages/create/template` and `examples/vite-app` | `scripts/demos.mjs` | Generated Vite applications |
| `verification/` | any local audit or visual-QA command | Maintainer-selected commands | Unversioned evidence and scratch reports |

## Rebuild

```sh
pnpm build
pnpm demos
```

`pnpm build` cleans package dist directories, root `dist/`, `standalone/`, and the TypeScript build-info cache before rebuilding. It then runs the browser bundler and standalone derivation. The standalone generator uses a normal `node_modules/@gneh/*` graph and copies the ordinary emitted packages without rewriting imports. Copied manifests replace `workspace:*` ranges with the release version and omit workspace-only LSP, language service, and Vite dependencies.

`pnpm demos` asks Vite to build the editable starter and the coexistence example, then deletes and recreates `demo/`. Its `generation.json` records both source projects. The landing page is also generated, so there is no hidden handwritten demo source.

## Verification is local by design

`verification/` is ignored at the repository root. A maintainer may place logs, screenshots, compatibility reports, or performance measurements there, but committed documentation must state commands and durable expectations rather than linking to a machine-specific result file.

The external `gneh-ws` corpus is also not copied into this repository. Run `pnpm audit:samples` to inspect a sibling corpus or set `GNEH_SAMPLE_DIR`.
