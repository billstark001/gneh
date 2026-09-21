# Limitations and security boundaries

gneh 0.1 is a working reference implementation, not an audited game engine or an arbitrary-code sandbox.

## Implemented scope

| Area | Current scope |
| --- | --- |
| Authoring | Three portable profiles over shared container and document tools; not full Harlowe or SugarCube |
| Metadata | JSON plus a JSON-compatible YAML subset; not YAML 1.2 |
| JavaScript | The restricted ESTree subset parsed and evaluated by pure-expr; ordinary JavaScript only in trusted ESM |
| Generated code | ESM embeds Story IR plus declarations and maps; the shared runtime evaluates its ESTree expressions |
| Reactivity | Transaction-level full-view recomputation with keyed identities; not fine-grained signals |
| Types | Typed Fragment props and state/props projection; external module bindings remain conservative |
| LSP | Protocol diagnostics, completion, hover, definitions, references, and conservative rename; no editor extension |
| Presentation | One DOM renderer, an editable three-mode vanilla starter, and framework-native story-flow starters; no Three.js or terminal renderer is included |
| Visual novel | Text beats, dialogue, and choices; no asset timeline, audio, skip, or read-history engine |
| Hot reload | Normal Vite module propagation; the starter does not preserve Story state across module replacement |
| Migration | Supported-profile rewrite plus diagnostics; not a universal legacy importer |
| Distribution | ESM, Vite applications, source/IR vendor APIs, and standalone domain CLI; no Twine story-format adapter |

## Trusted and untrusted code

Portable expressions do not use `eval` or `new Function`. They use pure-expr's parser/evaluator and access-policy APIs, deep read-only render state, finite Story execution budgets, and post-transaction JSON validation. gneh is not a hostile-code sandbox: source, imported bindings, and extensions are application-owned, and permissive call access is deliberate.

Structural parsers, nested lists, runtime IR traversal, and portable JSON validation also enforce nesting budgets. Excessively nested Karlowe input fails with a typed CST diagnostic, while Sugarcast's inspection CST preserves the over-deep remainder as lossless text and reports a diagnostic. Lists, StoryNode evaluation, metadata, and story state deeper than 128 containers are rejected before the JavaScript call stack can overflow. These limits are resource boundaries, not additional language features.

Imported `.mjs`, module helpers, and renderer extensions are normal trusted host JavaScript. Passing them to the runtime does not sandbox them. Their purity and host permissions remain the application's responsibility.

Interpolation emits scalar text and never reparses a returned string as HTML or markup. The DOM renderer does not use `innerHTML` and filters URL schemes. This is defense in depth, not an independent security audit. Host isolation and resource limits are still required for hostile files, remote plugins, or very large input.

## Saves and versioning

A save contains the ABI, story identity, route, props, JSON state, PRNG state, and bounded history. It does not serialize DOM nodes, region overrides, lexical closure environments, or native widgets. A Karlowe macro stored in state is the exception in representation, not behavior: state contains a portable declaration reference, and load reconstructs a fresh story-captured callable against the current state. Materialized Karlowe/Sugarcast expression caches, revealed interaction instances, and other view-local state are transient. After undo, redo, or load, the view is reconstructed from saved persistent state without replaying source effects; authors who require exact restoration of such UI must represent it in story state.

Version 0.1 has no automatic state-schema migration and no route migration after a module path is renamed. Large published projects should own a versioned migration policy. Runtime-created Fragments need a stable registry if they must survive a new session; static reachable bindings are registered automatically.

## Toolchain and test claims

The workspace declares pnpm 12, TypeScript 7, Oxlint, Oxfmt, and Vite 8. The language service separately uses a TypeScript 6 compiler API alias. `pnpm check` runs lint, format verification, a clean build, and Node tests.

The browser suite serves generated Vite applications to a real Chromium process through `puppeteer-core`. It checks starter behavior and coexistence with an unrelated frontend root; it is not a compatibility matrix for every framework.

Compatibility audits parse passages from real compiled Twine HTML. Their acceptance ratio measures the documented portable profile only. A customized story with private widgets can be a useful stress sample without defining SugarCube compatibility.

## Explicit rejection is part of the contract

Unknown, well-formed macros must become explicit `invoke` IR rather than silently becoming prose; compilation then requires a declared runtime-extension ID. Malformed syntax still produces diagnostics. Karlowe accepts portable value/view `(macro:)` definitions, semantic named hooks, and a documented presentation changer set, but not DOM/text selectors, `enchant`, `click` matching, timers, or arbitrary Harlowe macro protocols. Sugarcast accepts declarative source widgets by lowering them to portable callables, but excludes `Macro.add`, scripts and Wikifier/DOM integration. Trusted build configuration can register additional IR lowerings, but cannot silently expand the portable runtime boundary. Both compatibility dialects use explicit source-position effects rather than guessed hoisting. They share IR with Inkdown but do not accept Inkdown syntax.
