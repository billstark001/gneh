# Third-party notices

## twee-grind

Upstream: https://github.com/billstark001/twee-grind

Pinned source commit: `a51c373c280f10d1448bb3bbbb51b60a39b09349`.
This distribution does not depend on a writable upstream repository and does not fetch upstream at build time.

Only the following parser pieces were extracted and altered:

| Upstream source                                     | gneh destination                                | Changes                                                                                                |
| --------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `packages/harlowe-markup/src/utils/pratt-parser.ts` | `packages/karlowe/src/pratt-parser.ts` | Narrowed types, portable diagnostics and package-local integration; original Pratt algorithm retained. |
| `packages/harlowe-markup/src/markup/expression.ts`  | `packages/karlowe/src/expression.ts`            | A subset of operator-precedence definitions, adapted to the portable expression AST.                   |

These are **altered source versions**, not the original Harlowe implementation.
No Harlowe interpreter, DOM hooks, changer runtime, SugarCube engine, or original project dependencies were copied.
The Karlowe lexer, markup parser, and semantic lowering surrounding these pieces are
new gneh code; the old twee-grind/Harlowe lexer is not used.

The root twee-grind MIT license is in `licenses/twee-grind-MIT.txt`.
The Harlowe package's additional **zlib-style** license is in `licenses/twee-grind-harlowe.txt`; it is not MIT.
Both original copyright notices are retained. Relevant notices are also included with the individual packages.

## Acorn

The standalone ESM/vendor builds include Acorn 8.18.0, copyright its contributors, under MIT.
See `licenses/acorn-MIT.txt` and `standalone/node_modules/acorn/LICENSE`.
It parses JavaScript; gneh validates and lowers the supported portable subset rather than evaluating arbitrary source.

## parse5 and entities

`@gneh/cli` uses parse5 8.0.1 under MIT for standards-compliant HTML parsing.
parse5 uses entities 8.1.0 under BSD-2-Clause for the HTML character reference data.
Generated standalone distributions retain their license files under
`standalone/node_modules/parse5/LICENSE` and `standalone/node_modules/entities/LICENSE`.

## Commander

`@gneh/cli` uses Commander 15.0.0 under MIT for command declarations, option
validation, and generated help. Generated standalone distributions retain its license
at `standalone/node_modules/commander/LICENSE`.

## Build and development dependencies

TypeScript, pnpm, Vite, Oxlint, Oxfmt, vscode-languageserver and their transitive dependencies are installed normally by the workspace.
Their source/binaries are not copied into this archive. The standalone distribution does not contain a TypeScript compiler or a font file.
