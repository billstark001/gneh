# Third-party notices

## twee-grind

Upstream: https://github.com/billstark001/twee-grind

Pinned source commit: `a51c373c280f10d1448bb3bbbb51b60a39b09349`.

This package contains altered portions of:

| Upstream source | gneh destination | Changes |
| --- | --- | --- |
| `packages/harlowe-markup/src/utils/pratt-parser.ts` | `src/pratt-parser.ts` | Narrowed types, portable diagnostics, and package-local integration |
| `packages/harlowe-markup/src/markup/expression.ts` | `src/expression.ts` | Operator-precedence subset adapted to gneh's portable expression AST |

No Harlowe interpreter, hook/changer runtime, or DOM implementation is included. The root MIT notice is in `licenses/twee-grind-MIT.txt`; the Harlowe package's additional zlib-style notice is in `licenses/twee-grind-harlowe.txt`.
