# gneh

**Know how a story behaves without deciding how it must look.**

`gneh` is named after the Proto-Indo-European root _\*ǵneh₃-_ (“to know”). It is a renderer-neutral narrative toolkit with three authoring frontends, one semantic IR, one Fragment ABI, and one transactional story runtime. It is not a drop-in Harlowe or SugarCube engine.

- **Inkdown** combines Markdown-like prose with portable JavaScript expressions, actions, and ESM bindings.
- **Karlowe** is an explicit, portable Harlowe-like subset. It supports value/view macros stored in story state, anonymous and semantic named hooks, source-order effects, interactions, and portable presentation changers; selectors that depend on Harlowe's DOM runtime are rejected.
- **Sugarcast** is an explicit, portable SugarCube-like subset. Declarative `<<widget>>` definitions lower to the shared callable IR; runtime macro injection, scripts, and DOM injection are rejected.

All three languages use the same Twee 3 passage container and metadata merger. A navigable passage and an embedded component are the same typed `Fragment`.

## Create and run a project

Node.js 22.16 or newer is required. New applications use the standard npm initializer and Vite workflow:

```sh
npm create @gneh@latest my-story
# Framework-native starters are separate:
npm create @gneh@latest my-story -- --template react
# or: --template preact | vue
cd my-story
npm install
npm run dev
```

The generated interface is application source, not a runtime-owned shell. Vanilla, React, Preact, and Vue receive separate native implementations. React and Preact do not alias one another and the Preact starter does not use `preact/compat`.

The CLI remains focused on story-domain tooling and can also be used from the generated standalone distribution:

```sh
node standalone/gneh.mjs check examples/playground
node standalone/gneh.mjs metadata examples/playground -o metadata.json
node standalone/gneh.mjs graph examples/playground
node standalone/gneh.mjs import-twine story.html -o imported-story
node standalone/gneh.mjs inspect imported-story --level ir
```

Development servers, production web builds, asset handling and preview are Vite's responsibility. The CLI deliberately does not maintain competing `init`, `dev`, or HTML `build` implementations.

## Develop it

```sh
pnpm typecheck
pnpm lint
pnpm fmt:check
pnpm test
pnpm demos
pnpm test:browser
```

The workspace uses pnpm 12, TypeScript 7 for builds, Oxlint, and Oxfmt. The language service intentionally uses a separate TypeScript 6 compiler-API alias because the TypeScript 7 native CLI package does not expose the classic JavaScript language service API.

`pnpm build` produces three distinct artifact shapes:

1. `packages/*/dist`: ordinary ESM packages with declarations and source maps.
2. `dist/gneh*.global.js`: browser IIFE bundles built by Vite.
3. `standalone/`: a standard dependency-free Node module graph derived from the package outputs by `scripts/standalone.mjs`.

All three directories are generated. `demo/` is also generated, from `examples/`, by `pnpm demos`. See [Generated artifacts](docs/GENERATED_ARTIFACTS.md) for the exact provenance and regeneration commands.

## One source module, several passages

```inkdown
---
metadata:
  tags: [chapter-one]
---
:: Start [start] {"title":"The Night Archive"}
@action takeKey {
  @do $hasKey = true;
}

# The Night Archive

@if (!$hasKey) {
  [[Take the key => takeKey]]
} @else {
  [[Open the door -> Room]]
}

@EnemyCard({ enemy: $enemy })

:: EnemyCard {"params":["enemy"],"paramTypes":{"enemy":"{name: string; hp: number}"},"presentation":{"tone":"muted"}}
**{{ enemy.name }}** / HP: {{ enemy.hp }}

:: Room
The room beyond the door is quiet.
```

`$hp` in prose is syntax sugar for `{{ $hp }}`. Complex access stays explicit: `{{ $player.stats.hp }}`. Initial state is ordinary application data passed to `Story`; reusable source defaults may also live in story metadata.

File YAML owns module metadata, imports, named exports, and setup. Passage metadata lives only in Twee header JSON. The generated module default-exports an immutable `PassageSet` keyed by canonical ID.

## Handwritten JavaScript uses the same ABI

```js
import { definePassage, v } from '@gneh/runtime';

/** @typedef {{label: string}} Props */
export default definePassage({
  id: 'native:Counter',
  metadata: { params: ['label'] },
  capabilities: ['live'],
  render(ctx, props) {
    return v.p(
      props.label,
      v.text(ctx.state.count),
      v.button('+1', () =>
        ctx.mutate((state) => {
          state.count = Number(state.count) + 1;
        }),
      ),
    );
  },
});
```

A real `.mjs` file is standard ESM; gneh does not rewrite `$name` inside JavaScript. The complete ESM example is in `examples/vite-app/`.

## Package boundaries

| Package | Responsibility |
| --- | --- |
| `@gneh/core` | JSON state, Story/effect IR, pure-expr runtime integration, semantic views, and Fragment protocols |
| `@gneh/source` | Twee containers, front matter, metadata, and source locations |
| `@gneh/expression` | Shared pure-expr grammar, binding patterns, streaming scanners, and dialect lexer rules |
| `@gneh/syntax` | Dialect-neutral scanning, CST-to-IR lowering, and passage assembly |
| `@gneh/inkdown` | Inkdown directives and frontend assembly |
| `@gneh/karlowe` | Harlowe-like syntax and expression lowering |
| `@gneh/sugarcast` | SugarCube-like macro syntax and expression lowering |
| `@gneh/compiler` | Dialect-neutral project validation, graphing, ESM/declarations/maps, and migration output |
| `@gneh/runtime` | Fragment instances, transactions, navigation, history, regions, and saves |
| `@gneh/renderer-dom` | Keyed DOM reconciliation and an optional minimal Story-to-DOM adapter |
| `@gneh/vendor` | Source/IR browser loading and optional dynamic wikification |
| `@gneh/vite` | ESM compilation, project aggregation, and local passage exports |
| `@gneh/create` | Standard npm initializer and editable Vite application template |
| `@gneh/cli` | Diagnostics, metadata, graphs, migration, formatting, and non-Vite ESM output |
| `@gneh/language-service`, `@gneh/lsp` | TypeScript projection and Language Server Protocol adapters |

The package count follows optional dependency and runtime boundaries. Stable `src/index.ts` files only re-export named implementation modules.

## Documentation

- [Getting started](docs/GETTING_STARTED.md)
- [Language and compatibility profile](docs/LANGUAGE.md)
- [Syntax and runtime extensions](docs/EXTENSIONS.md)
- [DOM behavior and host integration](docs/DOM_BEHAVIORS.md)
- [Karlowe compatibility design](docs/KARLOWE_COMPATIBILITY.md)
- [Architecture and ownership](docs/ARCHITECTURE.md)
- [CLI reference](docs/CLI.md)
- [LSP setup](docs/LSP.md)
- [Limitations and security boundaries](docs/LIMITATIONS.md)
- [Generated artifacts](docs/GENERATED_ARTIFACTS.md)
- [Third-party provenance](THIRD_PARTY_NOTICES.md)

New gneh code is MIT licensed. Adapted parser code retains its original notices. No legacy interpreter is bundled, and compatibility frontends do not claim the full behavior of their source engines.
