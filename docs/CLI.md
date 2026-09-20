# CLI and frontend tooling

The CLI handles story-domain operations. Vite handles the frontend dependency graph, development server, assets, production build, and preview. This avoids maintaining two web toolchains with subtly different behavior.

Use the workspace CLI or the generated standalone entry:

```sh
pnpm gneh <command> ...
node standalone/gneh.mjs <command> ...
```

## Commands

| Command | Behavior |
| --- | --- |
| `check <file\|dir> [--json] [--types] [--snapshot]` | Parse, compatibility, reference, props, and capability diagnostics; `--types` adds TypeScript projection |
| `metadata <file\|dir> [-o file.json]` | Emit merged passage metadata keyed by ID |
| `graph <dir> [--json]` | Emit the static navigation/include graph as DOT or JSON |
| `compile <file\|dir> [-o dir]` | Emit ESM, `.d.mts`, source maps, and a manifest for a non-Vite pipeline |
| `migrate <file\|dir> [-o file.inkdown]` | Rewrite the supported portable profile to Inkdown and emit a report |
| `fmt <file> [-o file.twee]` | Canonicalize Twee headers and metadata without reformatting prose |
| `extract <story.html> [-o dir]` | Extract structured Twine data and decoded Twee without executing the HTML |
| `import-twine <story.html> [-o dir] [--dialect d] [--report file] [--preserve-container]` | Create editable gneh source; optionally emit audit artifacts |
| `inspect <file\|dir> [--level <level>]` | Emit versioned public parser/compiler records, optionally filtered with `--passage` |
| `lsp` | Start the workspace LSP on standard I/O; not included in standalone |

`check --types` requires the workspace language-service dependency. The standalone CLI reports that limitation instead of silently skipping type analysis.

The former CLI `init`, `dev`, and HTML `build` commands were intentionally removed:

- use `npm create @gneh@latest` for initialization;
- use `vite` / `vite build` / `vite preview` through the generated package scripts;
- use `@gneh/vendor` directly when an application explicitly needs source or IR data loading rather than ESM compilation.

## Configuration and discovery

CLI project discovery may read `gneh.config.json`. It may define `entry`, `sources`, `state`, `stateTypes`, `dialect`, and `live`. This file is CLI/LSP input only: the importer does not create it and Vite does not discover or execute it. Applications put project-scoped code and data in their explicit JavaScript/TypeScript entry, which may import JSON normally. `sources` contains relative files or directories, not glob expressions. Discovery is recursive and ignores hidden, dependency, build, standalone, and verification directories.

Recognized source extensions are `.inkdown`, `.karlowe`, `.sugarcast`, `.md`, `.twee`, and `.tw`. Neutral extensions default to Inkdown unless config or metadata selects a dialect. In Vite, the neutral extensions instead require an explicit `?gneh` query so the plugin can coexist with ordinary Markdown tooling.

## Vite story modules

Direct imports are the default application boundary:

```ts
import Start, { fragments } from './story/chapter.karlowe';
const Card = fragments.Card;
```

The plugin does not emit declarations beside sources. TypeScript projects include the client declaration for each selected frontend, such as `@gneh/karlowe/client`; these are conservative module types, while the language server provides concrete passage diagnostics.

Ambiguous source extensions require an explicit opt-in:

```ts
import Start from './chapter.inkdown';
import Notes from './notes.md?gneh';
```

Compose multiple files explicitly or with Vite's standard `import.meta.glob`; gneh does not add a second virtual-module aggregation interface.

The plugin does not install a full-page reload hook. Normal Vite module propagation and the host application decide whether to accept an update or reload.

## Twine extraction and import

`extract` is format-neutral and writes three files into a new, empty directory:

- `twine-story.json` retains every opening-tag attribute, the exact attribute text, encoded passage content, decoded source, tag definitions, user styles and scripts;
- `story.twee` is the decoded authoring representation;
- `extract-report.json` records format identity and container collisions.

```sh
gneh extract compiled-story.html -o extracted-story
```

`import-twine` maps Harlowe to Karlowe or SugarCube to Sugarcast and writes one editable story source. The Twine entry and title are placed in source front matter; it does not generate project configuration, declarations, or reports by default:

```sh
gneh import-twine compiled-story.html -o imported-story
gneh import-twine unknown-format.html -o imported-story --dialect inkdown
gneh import-twine compiled-story.html -o imported-story --report compatibility.json --preserve-container
```

Neither command executes the HTML or claims engine equivalence. Output directories must be empty. `--report` writes detailed diagnostics, while `--preserve-container` stores the lossless record below `.gneh/import/`. Embedded non-empty styles and scripts are written as separate files; they are never automatically imported or executed.

## Inspection

`inspect` emits `gneh.inspect/v1` JSON at one of three stable boundaries:

- `--level container`: Twee/front-matter passages before dialect parsing;
- `--level syntax`: per-source lowered syntax and diagnostics before project resolution;
- `--level ir`: the resolved Story IR and project diagnostics (the default).

Use `--passage <id-or-name>` to narrow the result and `-o` to write it to a file. The records are public gneh structures, not Karlowe lexer tokens or another frontend's private parser nodes.

## Compatibility audit

Audit one or more compiled Twine HTML files without importing them:

```sh
pnpm audit:twine -- --details ../gneh-ws/story.html
```

Audit every plain HTML or zip-contained HTML sample in a corpus directory:

```sh
pnpm audit:samples
GNEH_SAMPLE_DIR=/path/to/corpus pnpm audit:samples
```

The report counts accepted and rejected passages by diagnostic code. It is a read-only coverage probe, not a legacy importer or engine-equivalence claim.

## Relationship to twee-grind

These commands supersede twee-grind's experimental `extract` and `harlowe --ast|--tokens` commands. The old output contracts are intentionally not preserved: gneh records fidelity limitations explicitly and makes inspection dialect-neutral. This is source import and structural inspection, not twee-grind compatibility.
