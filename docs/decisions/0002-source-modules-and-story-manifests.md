# 0002: Separate passages, source modules, and authored callables

Status: accepted

## Context

ADR 0001 makes explicit, application-owned composition the default. It rejects hidden project assembly by directory scanning and leaves open how authored files, navigable passages, reusable callables, ESM linkage, and story metadata fit together.

The current model treats a Twee passage body as several things at once:

- an authoring-file section;
- a stable navigable passage or route;
- a reusable renderable component;
- a metadata container; and
- part of an ESM module's public surface.

Twee `::` headers are already a useful and familiar way to define passages. Removing them would force authors to split ordinary multi-passage stories into many files. The conflation to remove is therefore not passage and route identity: it is the implicit treatment of every passage as a reusable view callable.

GNEH also needs one account of source-module linkage, lexical capture, temporary state, and publication across its three dialects. Inkdown views and actions are lexical; Sugarcast widgets have capture-oriented behavior and normally register story-wide; Karlowe uses sigils and JavaScript-like lexical lookup. These distinctions should remain visible rather than being forced into one surface rule.

Finally, dynamically created callables may close over runtime environments. Their closures are useful in memory but must not become an executable save-file object graph.

## Decision

GNEH distinguishes these concepts:

- A **passage** is declared by a Twee `::` header. It has stable navigation, history, lifecycle, and save identity, and compiles to a runtime `Fragment`.
- An **authored callable** is an explicitly declared value, view, or effect callable. A view is reusable render behavior; it is not implicitly created for every passage.
- A **source module** is one `.inkdown`, `.karlowe`, or `.sugarcast` file and one generated ESM linkage unit. It may contain an optional module initializer, multiple passages, and explicit authored callables.
- A **PassageSet** is the keyed default export of a source module and the value combined by ordinary JavaScript or TypeScript application code.
- The **Story-global registry** is a transient per-`Story` registry populated by dialect publication operations. It is neither the ESM namespace nor persistent story state.

The runtime product remains the existing Fragment and callable IR. This decision does not introduce a second runtime Fragment model or a `.gneh` manifest language.

## Source-file structure

A native source file has this order:

```text
optional file YAML, first
headerless `primary` initialization region
:: First passage [tags] {JSON metadata}
passage body
:: Second passage [tags] {JSON metadata}
passage body
```

The YAML block must be absent or be the first effective source construct. A byte-order mark, whitespace, and comments may precede it; no declaration, prose, or passage header may do so. Only one YAML block is allowed, and passage-level YAML front matter is removed.

The headerless region after YAML and before the first `::` is parsed with the file's body dialect as the `primary` initialization region. It is evaluated once per ESM module instance. It uses the ordinary passage grammar and lexical-environment machinery but is not a navigable passage and is not included in the default `PassageSet`.

The `primary` region has no current Story or mounted Fragment. It may:

- establish immutable or mutable module lexical bindings;
- evaluate module-safe initialization effects;
- call trusted imported ESM bindings;
- declare value, view, and effect callables; and
- leave stable bindings for file-level ESM exports.

It may not immediately use facilities that require a Story or mount, including story-state access, an existing mount's temporary state, navigation, history, regions, route props, or Story-global publication. It may create `_` bindings owned by the module's own `primary` scope. Declaring an action which will use Story or mount facilities later is valid; executing such an action during module initialization is not.

Bare render output in `primary` is an error because it has no render host. Render content must belong to an explicit view declaration.

Module lexical mutation deliberately follows ordinary ESM lifetime. A mutable binding is initialized once per ESM module instance and may be shared by multiple Story instances in the same realm. It is not implicitly reactive, transactional, serializable, or undoable. Authors who need those properties use Story state, mounted temporary state, or an explicit persistence API.

## File YAML: metadata and ESM linkage

File YAML is intentionally limited to module metadata, static ESM imports and named exports, and an ordered runtime `setup` plan. It is not a project-composition language.

```yaml
---
metadata:
  title: The Night Archive
  tags: [chapter-one]

imports:
  ./Panel.mjs: Panel
  ./names.mjs: [formatName, normalizeName]
  ./ui.mjs:
    default: Layout
    Badge: EnemyBadge
    formatName: =

setup: [Definitions, Widgets]

exports:
  - EnemyCard
  InternalBadge: PublicBadge
---
```

Import entries are keyed by ESM module specifier and support three common value forms:

1. A string is a default import local name:

   ```yaml
   imports:
     ./Panel.mjs: Panel
   ```

   This is equivalent to `import Panel from './Panel.mjs'`.

2. An array contains same-name named imports:

   ```yaml
   imports:
     ./names.mjs: [formatName, normalizeName]
   ```

3. An object maps exported names to local names. The special value `=` means to retain the exported name, `default` selects the default export, and the quoted key `"*"` selects a namespace import:

   ```yaml
   imports:
     ./ui.mjs:
       default: Panel
       Badge: EnemyBadge
       formatName: =
     ./tools.mjs:
       '*': tools
   ```

An object may not combine `"*"` with other imports from the same entry.

The `exports` field controls generated ESM named exports only. A list exports bindings under their local names; an object maps local names to exported names. The compiler owns the default export, so YAML cannot specify `default` as an export name.

YAML imports and exports do not publish names to a Story. In particular, they are independent from Inkdown `@publish`, normal Sugarcast widget registration, Karlowe `$` callable assignment, and the runtime-extension registry. An imported binding is visible through the source module's static binding table. An exported binding becomes visible only to an ESM importer.

All bindings selected by `exports` must remain in the outer `primary` lexical environment after initialization and must be definitely assigned. A binding which exists only in a child branch, loop iteration, passage, or callable invocation is not a static ESM export candidate.

Mutable exported bindings retain ESM live-binding behavior. Generated code bridges evaluator cells to owned JavaScript bindings rather than exporting snapshots.

### Runtime setup passages

The singular field name `setup` denotes an ordered initialization plan. Its value is an array of canonical IDs for passages declared in the same source module:

```yaml
setup: [Definitions, Widgets]
```

After a Story has installed its initial or restored state, host bindings, runtime extensions, and empty transient registry, it evaluates the selected setup passages immediately and before mounting the entry passage. The same setup plan runs when a Story is newly created, reset, or loaded; it does not run on ordinary navigation.

A setup passage has Story context but no visible renderer host. Its declarations and source-order effects are evaluated, `$` writes are allowed, and Story-global publication works normally. Render output is discarded, interactions are not mounted, and navigation from setup is an error. If a published callable captures the setup passage's scoped temporary environment, that environment remains alive through the published closure.

The complete setup plan executes as one staged initialization transaction. If any setup passage fails, its state writes and registry publications, and those of earlier setup passages in the same plan, do not commit; Story construction, reset, or load reports the failure.

Setup execution order is deterministic: entries in one `setup` array run from left to right, and `definePassages` concatenates inherited plans in the order in which input PassageSets are supplied. Explicit setup entries added by a `definePassages` options object follow the inherited entries. Duplicate setup passage identities are errors rather than repeated execution.

Every setup reference must resolve to a passage in the resulting PassageSet. File YAML may reference only passages from its own source module; application composition may select any passage present after its inputs have been combined.

This order exists for reproducibility, not as a recommended dependency mechanism. Setup passages should normally be independent. Initialization which requires strict internal sequencing should live in one setup passage or an explicitly structured callable instead of relying on the relative order of unrelated modules.

Marking a passage for setup does not remove it from the PassageSet or change its route identity. Applications may choose not to expose setup passages in navigation UI.

### Binding-kind inference

YAML normally does not declare whether an import is a value, view, effect, passage, or PassageSet. GNEH definitions carry a stable runtime and type-level brand, and the dialect use site supplies an expected phase:

- a render call expects a view;
- an action call expects an effect callable;
- an expression call expects a value callable;
- a navigation target expects a passage; and
- `definePassages` expects passages or PassageSets.

Handwritten modules use the same public definitions as generated modules, such as `defineView`, `defineAction`, `defineValue`, `definePassage`, and `definePassages`. An unbranded JavaScript function is ambiguous and must be adapted explicitly. Compiler-generated modules for all three dialects use these same definitions, so their kinds require no separate YAML annotation.

## Twee headers define passages and routes

Native `.inkdown`, `.karlowe`, and `.sugarcast` files retain the Twee 3 passage header:

```text
:: Passage name [tag1 tag2] {"position":"100,200","custom":true}
```

The header declares a stable passage and route. The body is the passage's render/effect program; it is not wrapped in or exported as an authored view. Reusable components still require an explicit dialect view declaration.

The header JSON remains fully Twee-compatible and is the only passage-specific metadata surface. GNEH-specific fields such as `id`, `params`, and `paramTypes` may coexist with imported Twine metadata. Header JSON must remain a JSON object, not YAML.

The display/source name comes from the header. A string `id` in header JSON, when present, supplies the canonical runtime ID. Navigation, PassageSet keys, history, and save identity use the canonical ID. Otherwise the header name is the ID.

A passage without an explicit view renders its own body normally:

```inkdown
:: Start [start] {"title":"Welcome"}

# Welcome

[[Continue -> Room]]
```

Declaring a view remains explicit and does not happen merely because prose follows a header:

```inkdown
@view EnemyCard({ enemy }) {
  **{{ enemy.name }}**
}

:: Battle

@EnemyCard({ enemy: $enemy })
```

Navigation arguments must be JSON- and save-safe because they may cross history and save boundaries. Nested view calls may use transient runtime values.

Compatibility constructs such as Sugarcast `<<include>>` and Karlowe `(display:)` may mount a passage as a nested Fragment. That does not turn the passage into a view callable: passage inclusion retains Fragment identity and lifecycle, while a view call uses callable invocation semantics.

## Generated ESM and PassageSet

`PassageSet` is an immutable keyed collection whose keys are canonical passage IDs. It also carries a compiler-owned, non-enumerable ordered setup plan:

```ts
declare const passageSetSetup: unique symbol;

type PassageSet = Readonly<Record<string, Passage>> & {
  readonly [passageSetSetup]: readonly Passage[];
};

type PassageRecord = Readonly<Record<string, Passage>>;
type PassageInput = Passage | PassageSet | PassageRecord;

interface PassageSetDefinition {
  passages: PassageInput | readonly PassageInput[];
  setup?: readonly (Passage | string)[];
}
```

Strings in a TypeScript `setup` list are canonical IDs resolved against the resulting collection; direct Passage references are preferred when already available. YAML uses canonical-ID strings because its selected passages are declared later in the same source file.

The keyed passage collection is semantically unordered. Only the opaque setup plan is ordered. Entry selection must use explicit application configuration, a unique `[start]` tag, or another explicit story rule; it does not fall back to the first object property. Source order may be retained separately for diagnostics and formatting but is not route identity or application order.

A source such as:

```inkdown
:: Start [start] {"title":"Welcome"}
# Welcome

:: Card {"id":"EnemyCard"}
Card body.
```

generates the equivalent of:

```ts
const Start: Passage = definePassage({
  id: 'Start',
  name: 'Start',
  tags: ['start'],
  metadata: { title: 'Welcome' },
  // compiled body IR
});

const __passage1: Passage = definePassage({
  id: 'EnemyCard',
  name: 'Card',
  metadata: {},
  // compiled body IR
});

const passages = definePassages({
  passages: {
    Start,
    EnemyCard: __passage1,
  },
  setup: [],
} satisfies PassageSetDefinition);

export default passages;
```

Generated JavaScript omits TypeScript annotations and `satisfies`, but retains the `definePassages` call for branding, freezing, key/ID validation, and diagnostics. Passage names which are not safe JavaScript identifiers use compiler-owned local names and quoted object keys.

`definePassages` is an ordinary pure JavaScript function, not a compiler macro. It accepts keyed passages and existing PassageSets, rejects duplicate canonical IDs unless an explicit policy says otherwise, and returns the same PassageSet type. Its object form provides exactly the same setup capability as file YAML:

```ts
export default definePassages({
  passages: {
    Start,
    Definitions,
    Widgets,
  },
  setup: [Definitions, Widgets],
});
```

It is also nestable. The short form inherits and concatenates the setup plans carried by its inputs:

```ts
import intro from './intro.inkdown';
import reading from './reading.karlowe';
import vault from './vault.sugarcast';
import { definePassages } from '@gneh/runtime';

export default definePassages(intro, reading, vault);
```

Composition which adds setup passages uses the object form. Inherited plans run first in input order, followed by the explicitly listed passages:

```ts
export default definePassages({
  passages: [intro, reading, vault],
  setup: [ApplicationSetup],
});
```

Project composition may live in any ordinary `.js`, `.mjs`, `.ts`, or `.tsx` file. `index.gneh.ts` is only an optional naming convention. `defineStory` is likewise an ordinary typed function and may receive the composed PassageSet, entry, state, story metadata, and host bindings in normal application code. The PassageSet already carries its setup plan.

This decision does not add a core glob macro. A host may use an explicit facility such as Vite's `import.meta.glob`; tooling may statically understand common direct-import and `definePassages` forms without making static analyzability a runtime correctness requirement.

## The `primary` environment and generated module order

The `primary` initializer is the module lexical parent of declarations made directly within it. It is not the lexical parent of declarations created later inside passage evaluation.

Generated ESM is organized conceptually as follows:

1. emit YAML-requested ESM imports;
2. import GNEH runtime helpers;
3. initialize the `primary` environment;
4. expose stable primary bindings as local ESM live bindings;
5. define passage descriptors;
6. construct the default PassageSet;
7. emit YAML-requested named exports; and
8. emit the compiler-owned default export.

Although ESM imports and exports are statically linked, this textual organization makes initialization and source-order behavior inspectable.

## Persistent scoped temporary variables

A `_` binding is a persistent, scoped temporary variable. "Persistent" here means that its value outlives the statement or render which created it; it does not mean that it is part of a save file. Its owner may be a module, capture, lexical block, callable invocation, or mounted Fragment according to the dialect and construct. The binding remains alive while its owning scope or any mounted Fragment, callable closure, Story-global registration, module export, or other reachable value still references that scope. It may be collected once the scope has no remaining references. A Fragment-owned scope therefore normally becomes collectible after unmount and after every closure or registration which captured it has also been released.

`_` bindings are not serialized, restored, or rewound by default. `$` state remains the JSON-safe Story state used for transactions, history, undo/redo, and saves. Module lexical bindings have ordinary ESM lifetime. Authors use an explicit GNEH persistence API when a different lifetime must participate in save/load.

The dialects deliberately choose different scope owners and callable environment chains.

### Sugarcast temporary scope

Sugarcast `_` variables follow the capture which created them. Evaluating a structural capture creates or reuses its capture environment according to the construct's lifecycle. A widget defined inside that capture closes over the capture, and retaining or publishing the widget retains the captured temporary scope.

Calling a widget creates only the invocation bindings `_args` and, for a container widget, `_contents`. It does not clone every captured `_` binding into a fresh widget-local environment. Other `_` names resolve through the widget's definition capture.

The environment chain for a Sugarcast view or action invocation is, from lowest to highest precedence:

```text
mount scope -> definition capture -> invocation arguments
```

The rightmost binding shadows an equally named binding to its left. This differs intentionally from SugarCube behavior where required to preserve GNEH closure semantics.

### Karlowe temporary scope

Karlowe `_` variables follow ordinary lexical scopes, close to JavaScript. A `(set:)` assignment searches the current scope and then its lexical parents. If the name exists, it updates the binding in its original scope. If it does not exist, `(set:)` creates a mutable binding in the current scope.

Karlowe macros and views form closures over their definition environments. This intentionally differs from Harlowe where necessary and matches the capture behavior provided to Sugarcast callables.

The environment chain for a Karlowe view, effect, or value callable is:

```text
definition environment -> invocation arguments
```

Arguments shadow captured bindings of the same name.

### Inkdown temporary scope and declaration rules

Inkdown follows the same lexical lookup and closure rules as Karlowe. Assignment updates the nearest existing lexical binding and creates a mutable binding in the current scope when no binding exists.

`@let` and `@const` are declarations rather than alternate spellings of assignment:

- `@let _x = value` declares a mutable `_x` in the current scope even when an outer `_x` exists;
- `@const _x = value` declares an immutable `_x` in the current scope;
- redeclaring a name already declared directly in the same scope with `@let` or `@const` is an error;
- either declaration may shadow a binding from an outer scope;
- `@do _x = value` updates the nearest existing `_x`, or creates a mutable `_x` in the current scope when none exists; and
- `@const $x` is invalid because `$x` is Story state rather than a lexical binding.

For now, `@let $x = value` and `@do $x = value` both write the same Story-state property. This equivalence is explicit rather than an implication that `$` state is lexical.

The same duplicate-declaration rule applies to plain local lexical names introduced by `@let` or `@const`. Parameters and compiler-created argument bindings are direct declarations in the callable invocation scope and cannot be redeclared there.

The environment chain for an Inkdown view, effect, or value callable is:

```text
definition environment -> invocation arguments
```

Arguments shadow captured bindings of the same name.

## Bounded and unbounded callable declarations

A bounded callable has an explicit closing delimiter. Once its declaration completes, its binding is materialized in the surrounding lexical environment and is visible to later sibling statements. Declarations follow source order and are not hoisted.

An unbounded callable consumes the remainder of its current syntactic container. It may follow any number of bounded declarations or lexical initializers and may capture them. It is necessarily the final sibling in that container, but it need not be the first declaration.

Declarations nested inside an unbounded callable body are created when that callable is invoked and close over that invocation environment; they are not siblings of the outer callable.

### Inkdown views and actions

Inkdown supports bounded views and actions:

```inkdown
@view Badge(label) {
  **{{ label }}**
}

@action dismiss() {
  @do $notice = null;
}
```

It also supports unbounded forms:

```inkdown
@view Inventory()

# Inventory

@each (item of $items) {
  - {{ item.name }}
}
```

```inkdown
@action reset()

@do $count = 0;
@do $items = [];
```

An action name is always required. `@action()` is a syntax error in both bounded and unbounded forms.

An omitted view name is inferred from the nearest named source container: the enclosing Twee passage name, or `primary` in the headerless initializer. A nested container without a stable contextual name requires an explicit view name. Two declarations may not claim the same direct binding in one lexical scope.

An Inkdown unbounded callable automatically escapes after its declaration completes:

- in the `primary` initializer, the compiler automatically adds it to the generated ESM named exports; and
- in any runtime passage or nested runtime container, evaluation behaves as if an explicit `@publish { name }` were inserted as the final operation at the container boundary.

The automatic export or publication occurs after the callable declaration has materialized. It is not declaration hoisting, and a source statement before the declaration cannot reference or publish the callable.

For example:

```inkdown
:: A

@view()

# View A
```

is equivalent in publication behavior to a bounded declaration followed at the passage boundary by `@publish { A }`. The view body is not rendered merely because it was declared; mounting passage `A` creates and publishes the view named `A`.

The bounded spelling remains explicitly controllable:

```inkdown
:: B

@view() {
  # View B
}

@publish { B }
```

`@publish` copies a visible binding into the current Story's transient global registry. `@publish *` takes a source-order snapshot of the publishable bindings which have already materialized directly in the current lexical block at that exact evaluation point. It does not subscribe to the block, hoist later declarations, or publish anything defined afterward. It also excludes inherited names, parameters, props, compiler intrinsics, ESM imports, and declarations belonging only to child blocks.

```inkdown
:: Definitions

@view First() {
  First
}

@publish *

@view Later() {
  Later
}
```

This publishes `First` only. Publishing `Later` requires another explicit publication operation or an applicable unbounded-callable automatic publication rule.

### Sugarcast views

A normal Sugarcast `<<widget>>` declaration registers a Story-global view when it is evaluated, including when it is defined inside a capture. The widget closes over its definition capture, and registration may therefore extend that scope's lifetime.

`<<widget local ...>>` creates a lexical view instead. A local widget is visible in its declaration scope and descendants and retains that scope while the widget remains reachable.

Sugarcast retains its bounded widget forms and the unbounded top-level form:

```sugarcast
<<widget "Panel">>

! Panel
```

An unnamed unbounded view in `primary` has the contextual name `primary` and is emitted as a stable ESM named export. Sugarcast's normal runtime widget registration remains Story-global rather than ESM-global.

### Karlowe views and macros

Karlowe provides `(view:)` as its direct view-declaration macro. An explicit target carries its sigil:

- a `$` target registers the callable in the current Story-global registry;
- an `_` target creates a lexical temporary binding; and
- an omitted target uses the nearest stable contextual name, including `primary` in the initializer or a passage name in a passage.

Bounded views use an attached hook. Unbounded views consume the current container. A stable unbounded callable created in `primary` is emitted as an ESM named export; runtime `$` registration and lexical `_` binding retain their normal Karlowe meanings.

Karlowe `(macro:)` remains available for value and view-producing callables. Macros and direct views both capture their definition lexical environment.

## The Story-global registry is transient

Story-global publication is scoped to one `Story` instance. It never mutates a process-global dialect registry or the ESM namespace.

Registry writes produced by an evaluation or render are staged and commit only if that evaluation or render succeeds. Committing a registration does not itself trigger another render. A later committed registration of the same name replaces the earlier registration; development tooling should report suspicious replacements. A registration remains present if a later render no longer enters the branch which created it. Undo and redo do not rewind the registry.

Story reset, Story replacement, load, or Story disposal clears the transient registry. Save data never serializes authored callable objects, closure environments, executable source, module lexical state, or captured temporary values.

Loading proceeds conceptually as follows:

1. clear transient Story-global registrations;
2. restore persistent JSON-safe Story and route state;
3. install host bindings and runtime extensions;
4. relink stable passages and static ESM definitions;
5. evaluate the PassageSet's ordered setup plan; and
6. render the restored passage.

Authors who rely on conditional or render-time publication must recreate those registrations through application setup or deterministic rendering after load.

An optional non-executable compatibility record may contain only the published name, registration phase, stable declaration identity when one exists, and a digest of the capture shape. It contains neither capture values nor executable representation.

## Name resolution and collisions

Name lookup follows each dialect's environment chain described above. Invocation arguments have the highest callable-local precedence. Lexical bindings precede Story-global registrations, module bindings, and linked passage names unless a dialect construct explicitly requests one of those namespaces.

Duplicate declarations directly in one lexical scope are errors. A child scope may shadow a parent binding. Assignment without an explicit declaration follows the dialect rules above and does not create an accidental sibling redeclaration.

Passage canonical IDs must be unique in one composed PassageSet. `definePassages` reports collisions. Namespacing and internal navigation-reference rewriting, when needed, are explicit options of application-owned composition rather than hidden filesystem behavior.

ESM cycles retain ordinary ESM semantics. Application composition cycles which attempt to construct PassageSets recursively are errors or ordinary JavaScript initialization failures; GNEH does not invent a separate manifest-cycle model.

## Interchange files

`.twee` and `.tw` are no longer native project source extensions claimed by the CLI, LSP, compiler, or Vite plugin. The Twee header syntax remains fully supported inside `.inkdown`, `.karlowe`, and `.sugarcast` files.

Twine extraction continues to produce `story.twee` as a decoded interchange and audit artifact. Import converts it into a selected native dialect extension while retaining compatible `::` boundaries, tags, and header JSON. A `.twee` artifact is not compiled as application source until an explicit import or migration selects a GNEH body dialect.

## Canonical renderers and the conformance boundary

GNEH defines a canonical XML-like structural renderer and a plain-text projection as small host-neutral conformance targets. They use deterministic node names, attribute ordering, escaping, and JSON encoding. Runtime callbacks are represented by stable harness handles rather than serialized functions.

The harness can:

- render a passage or nested Fragment;
- invoke nested views;
- activate links and actions;
- issue input-change events;
- observe persistent state, scoped temporary state, route navigation, and Story-global registrations; and
- exercise module initialization and save/load boundaries.

The conformance matrix covers passage identity, view and action parameters, dialect-specific scope ownership, lexical capture, bounded and unbounded declarations, automatic Inkdown publication, setup-plan ordering and rollback, conditional registration, collision behavior, failure rollback, navigation arguments, and save/load reconstruction.

Equivalent shared-IR programs must produce the same canonical structure and observable state transitions where this decision defines shared behavior. Dialect-specific capture chains remain explicitly different and receive their own conformance cases.

## Consequences

- Twee `::` keeps its intended role as passage and route declaration syntax.
- A passage body is not implicitly a reusable view; reusable callables require explicit dialect declarations.
- Multi-passage native files remain supported without forcing one file per route.
- File YAML becomes a small module-linkage surface rather than a project-manifest language.
- Passage-specific metadata uses the Twee-compatible header JSON form.
- Generated source modules and handwritten JavaScript share the same branded Passage, PassageSet, and callable definitions.
- The default export of every native source module is a keyed PassageSet, so ordinary TypeScript can compose source modules with `definePassages`.
- YAML and `definePassages` expose the same ordered `setup` facility; composed PassageSets inherit setup plans deterministically without making route lookup ordered.
- No `.gneh` manifest, custom manifest macro language, or required manifest filename is introduced.
- The `primary` region provides ESM-like module initialization, mutable lexical state, stable named exports, and no implicit Story context.
- Inkdown unbounded views and named actions are useful without hoisting: they automatically export from `primary` or publish at the end of a runtime container.
- Anonymous Inkdown actions remain unsupported.
- Scoped `_` variables persist for the lifetime of their reachable scope but remain outside saves and undo/redo unless an explicit API says otherwise.
- Sugarcast capture scope and Karlowe/Inkdown lexical scope remain observably different.
- Dynamic Story publication remains expressive but deliberately transient and non-serializable.
- `.twee` remains a preserved interchange format but is no longer an ambiguous project source extension.
- Hidden directory scanning, implicit project composition, implicit entry-by-first-passage selection, and closure serialization remain outside the accepted model.
