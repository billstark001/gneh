# Architecture and ownership

## The central boundary

```text
Inkdown ─────┐
Karlowe ─────┼─> semantic IR ─┬─> interpreter ─┐
Sugarcast ───┘                 └─> ESM emitter ─┤
handwritten ESM ────────────────────────────────┤
                                               v
                                          Fragment ABI
                                               |
                                      Story transactions
                                               |
                                        semantic View[]
                                               |
                                      renderer adapter
                                               |
                                  host application / template
```

The IR describes story behavior, not DOM behavior. `View.kind = "paragraph"` is
document semantics rather than an `HTMLElement`. Source spans remain attached to IR
for diagnostics, generated code, and language-service mapping. The current ABI is 1.

## Frontend phases

Karlowe and Sugarcast do not ask a semantic registry how to tokenize or balance
source. Their delimiter-aware scanners first build dialect-owned, lossless CST,
including unknown macro names and container bodies. Built-in or caller-provided
lowerings then translate those nodes to the shared story IR:

```text
source -> dialect CST -> CST-to-IR lowerings -> reference resolution -> StoryIR
                                                               |
                                               declared invoke capabilities
                                                               |
                                                   RuntimeExtension
```

Inkdown directives use the same lowering contract, although its native grammar can
assemble passage structure directly. A lowering is trusted build code; it is not a
runtime callback and cannot add a new evaluator namespace.

Expressions have one closed core AST. References explicitly identify `state`,
`temporary`, `lexical`, `props`, `intrinsic`, or application `binding` namespaces;
operators are finite unions rather than unchecked strings. Every parsed expression
node may retain its own source origin. Dialect expression parsers normalize into
this form before the runtime or ESM emitter sees them, and a project resolution pass
classifies module/application bindings without falling back to dynamic name lookup.

Unknown compatibility macros lower to `invoke` IR. Compilation requires the
application to declare each extension ID; execution requires a matching
phase-limited `RuntimeExtension`. This is intentionally parallel to renderer and
host boundaries. It does not grant source code the authority to register executable
widgets, custom macros, scripts, or DOM operations.

## Dependency direction

The dependency graph is intentionally one-way:

```text
core
├── source
├── expression
├── syntax
│   └── dialect frontends (with source + expression)
└── runtime
    └── renderer-dom

source + expression + syntax + dialects
└── compiler
    ├── vite
    ├── language-service ─> lsp
    ├── vendor
    └── cli

create ─> editable Vite application template
```

The diagram omits some direct imports, but its ownership rules are strict:

- `core` has no parser, DOM, build-tool, or application dependency.
- `source` parses Twee/front matter and does not choose a story language.
- `syntax` is dialect-neutral infrastructure. `MarkupParser` receives both an
  expression parser and an optional special-syntax reader from its caller. Its
  caller-owned `MacroLoweringRegistry` dispatches dialect tokens without global state or a
  dependency from core to authoring syntax.
- Inkdown owns `@if`, `@action`, `@module`, and related directives.
- Karlowe and Sugarcast own their compatibility syntax and do not recognize
  Inkdown directives. Shared tools do not imply a shared surface language.
- All dialects lower to the same IR and never own a separate runtime.
- The compiler has no CLI I/O; the CLI composes compiler and filesystem concerns.
- Vite owns frontend serving, asset graphs and production builds. The CLI does not
  maintain a parallel web server or HTML bundler.
- The runtime knows the renderer protocol but not the DOM renderer.

This division is why `@gneh/syntax` remains a package while the three frontends are
not collapsed into it. Conversely, `src/index.ts` files are kept as small stable
export surfaces; implementation lives in named files such as `renderer.ts`,
`project.ts`, and `directives.ts`.

Lowering registries are build configuration, not runtime ABI. Frontends register
their built-ins through the same path exposed to applications; only delimiters,
attached body/section structure, and dynamic Fragment calls remain parser grammar.
Unknown compatibility macros become explicit `invoke` IR and cross the separately
declared `RuntimeExtension` boundary. See [Syntax and runtime extensions](EXTENSIONS.md).

## Fragment ABI

The public type is defined in `@gneh/core`:

```ts
interface Fragment<P extends object = Record<string, unknown>> {
  readonly kind: 'gneh.fragment';
  readonly id: string;
  readonly metadata: Metadata;
  readonly capabilities: readonly string[];
  readonly bindings?: Readonly<Record<string, unknown>>;
  enter?: (ctx: FragmentContext, props: P) => void;
  render: (ctx: FragmentContext, props: P) => ViewInput;
}
```

`defineFragment()` creates a handwritten Fragment. `defineIRFragment()` adapts
portable IR. Generated ESM uses the same adapter with generated expression
evaluators. There is no second “component” or “passage class”.

The statement that `.inkdown` and `.mjs` are equivalent means that they meet at this
ABI. It does not imply byte-identical output, reversible JavaScript, or identical
source maps. Generated modules are normal ESM and do not use string evaluation.

## Modules and large projects

A multi-passage source file has one lexical module scope. Bindings declared by
`@module` and local entries in `fragments` share a binding table with live getters.
A local `@Card()` resolves inside that file before the external registry.

Vite assigns stable module-scoped IDs such as `path/chapter.inkdown#Card`. Renaming
the file changes that ID; version 0.1 does not migrate saved routes automatically.
Applications that require long-term save compatibility should own a route/state
migration policy.

CLI compilation does not have an application module graph and therefore requires
globally unique passage IDs. Vite modules allow the same local passage name in
separate files. This is an explicit distinction between project analysis and
application bundling, not accidental behavior.

## Effects, transactions, and rendering

- `render` receives read-only state and may be called more than once.
- `enter` runs once when a Fragment instance is first mounted.
- actions and `ctx.mutate` run inside synchronous transactions.
- a failed mutation, invalid JSON state, expression-budget overflow, or structural
  error rolls back the transaction.
- successful actions and navigation create bounded history snapshots.
- asynchronous transactions and atomicity across `await` are not supported.

Inkdown passages use reactive structural evaluation. Karlowe and Sugarcast passages
use materialized evaluation: expressions and source-position effects are evaluated
once per mounted Fragment, in document order. Bound form controls are the deliberate
exception and continue to observe current state. This policy lives on `PassageIR`;
the runtime does not infer semantics from a dialect name.

Version 0.1 recomputes the current semantic view after a transaction. Stable include
and loop keys preserve Fragment and DOM identity, but this is not a fine-grained
signal graph and does not promise O(changed nodes) work.

Snapshot mode can render and navigate but rejects action buttons and mutable
regions. Live mode enables those capabilities. They use one runtime, not separate
interpreters.

## Region ownership

```js
const handle = ctx.region('notes');
handle.set(v.p('replacement'));
handle.append(v.p('more'));
handle.clear();
handle.reset();
```

A region belongs to the Fragment instance that declared it. It is not a global hook
selector or a `document.querySelector` alias. Handles become stale when their owner
is unmounted. Region overrides are transient UI state and are not serialized into
history or saves; persistent content belongs in story state.

Karlowe named hooks lower to these regions. `replace`, `append`, and `prepend` accept
only a semantic `?hook` reference. `?sidebar` lowers to a host portal operation, so
the application chooses where a sidebar exists and how it is rendered. Missing host
operations fail explicitly rather than acquiring browser globals in the core. A
portal host may return a cleanup function; the owning Fragment invokes it on dispose.

## Renderer and application boundary

```ts
interface Renderer<Host, Handle> {
  mount(host: Host, view: View[]): Handle;
  update(handle: Handle, view: View[]): void;
  dispose(handle: Handle): void;
}
```

The repository implements one DOM backend. Other hosts may implement the protocol,
but the project does not claim that a Three.js or terminal backend already exists.
`DOMRenderer` supports typed extension renderers with explicit mount/update/dispose
ownership. `mountStory` is a minimal optional bridge: it subscribes one Story to one
host and installs no styles, globals, router, or document-level listeners.

Navigation chrome, history controls, persistence and Wiki/story-flow/visual-novel
layouts belong to the editable initializer template. Moving that code out of a
runtime package makes the customization boundary honest and lets React, Vue or an
existing application use `Story` directly. Extensions and imported JavaScript are
trusted host code.

## Vite coexistence boundary

Native story extensions are unambiguous and compile automatically. `.md`, `.twee`
and `.tw` may belong to documentation systems or other plugins, so gneh only handles
them with an explicit `?gneh` query. The plugin does not inject global CSS, mount an
application, aggregate story files behind a virtual alias, or force full-page reloads.
Native story files are ordinary ESM modules; applications compose multiple modules
explicitly or with Vite's standard `import.meta.glob`.

## Import and inspection boundaries

Twine HTML extraction belongs to `@gneh/cli`: it reads only `tw-storydata` and
`tw-passagedata`, preserves raw attribute/source representations, and never executes
the published page. It uses parse5's HTML tree and source locations instead of a
second, partial HTML grammar. Keeping this parser internal to the only runtime
consumer prevents `@gneh/source`, compiler, and browser installations from acquiring
an HTML-parser dependency. The CLI workflow adds filesystem policy, dialect selection
and a compatibility report. Import diagnostics describe the portable gneh profile;
they do not claim Harlowe or SugarCube runtime equivalence.

Commander owns CLI tokenization, required arguments, option choices, help, and error
reporting. Commands receive typed option objects and do not reinterpret raw argv or
retain aliases for removed interfaces.

Inspection exposes three versioned boundaries—container records, frontend-lowered
syntax, and resolved Story IR. It deliberately excludes dialect-private token
streams so tooling does not become coupled to the implementation inherited from an
upstream parser.

## Interpreter and generated-code agreement

Portable expressions can be interpreted or emitted as guarded JavaScript. Both
paths share property, call, and optional-chain semantics. Tests compare state,
visible text, choices, and navigation rather than treating the existence of an ESM
file as proof of semantic equivalence.

Structural traversal and actions still reuse runtime IR machinery. Source maps are
expression-level and do not promise exact columns for every token produced by a
dialect alias transformation.
