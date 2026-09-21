# gneh 0.1 language and container profile

This document describes the implemented portable profile. It is not the official Harlowe or SugarCube specification and does not claim full CommonMark or YAML 1.2.

Executable cross-language examples live in [`packages/conformance/cases`](../packages/conformance/cases), whose [README](../packages/conformance/README.md) defines the Markdown case format and renderer projections.

## Shared source container

Every dialect uses the same `@gneh/source` passage splitter:

```text
:: Passage name [tag1 tag2] {"position":"100,200","custom":true}
```

A headerless region before the first Twee header is the source module's `primary` initializer, not an implicit passage. File YAML may appear once as the first effective construct and owns only module metadata, ESM linkage, and the ordered setup plan. Passage metadata belongs exclusively in header JSON.

```inkdown
---
metadata:
  tags: [book]
imports:
  ./ui.mjs:
    default: Panel
exports: [formatTitle]
---
@view formatTitle(title) {
  **{{ title }}**
}

:: Card [component] {"id":"EnemyCard","position":"1,2","layout":{"tone":"quiet","density":"compact"}}
{{ props.enemy.name }}
```

The example keeps the display name `Card` while using the canonical runtime ID `EnemyCard`. Routes, saves, `PassageSet` keys, and references use only that canonical ID; `Card` is not an alias.

Front matter is a JSON-compatible YAML subset: indented objects, scalar lists, flow arrays/objects, strings, finite numbers, booleans, null, comments, and block strings. Anchors, aliases, tags, implicit dates, tab indentation, and object-list shorthand are rejected. Duplicate or prototype-polluting keys are errors.

Code fences do not open new Twee passages. CRLF and Unicode source offsets are preserved. Header brackets can be escaped.

## Shared semantics

- `$hp` in prose and `{{ $hp }}` produce the same value node.
- Bare `$` and `_` expressions use pure-expr's interpolation scanner, so `$player.hp`, `$items[0]?.name`, and `_format($value)` remain one value expression. Braces remain useful when an expression does not begin with a sigil.
- Inline code and `\$hp` remain literal. `$1.50` is currency, not a state reference.
- `$name` reads persistent story state; `state.name` exposes the same state object. `_name` is a scoped, non-serialized lexical temporary. Plain names resolve props, loop locals, authored lexical bindings, Story registrations, or module bindings, and `props.enemy` remains available explicitly.
- Render expressions cannot mutate. Writes occur during enter or action effects.
- State must remain finite JSON data; functions, DOM nodes, cycles, and unsafe keys are rejected.
- Effect-time randomness uses a seeded PRNG stored in snapshots. Render-time randomness is rejected.

These semantics belong to gneh. Familiar surface syntax does not import the source engine's complete value, history, or rendering model.

## Inkdown

```inkdown
@do $visits += 1

@action damage(amount) {
  @do $enemy.hp -= amount;
}

@action attack({ amount = 1 }) {
  @call damage(amount);
  @let entry = { id: $log.length, text: 'attack' };
  @do $log.push(entry);
}

@if ($enemy.hp > 0) {
  [[Attack => attack({amount: 2})]]
} @else {
  [[Continue -> Hallway]]
}

@each (item of $inventory; key item.id) {
  - {{ item.name }}
}

@EnemyCard({ enemy: $enemy })

@view EnemyBadge({ enemy }) {
  **{{ enemy.name }}**
  @children
}

@region notification {
  No messages.
}
```

Loop keys must be unique strings or numbers. Without an explicit key, gneh uses `item.id` when available and otherwise the index. `@do`, `@let`, and `@const` execute in source order once per mounted scope; `@const` creates an immutable lexical binding. `@action` and `@view` are source-ordered lexical declarations: a declaration in a branch or loop iteration is visible only in that block and closes over that block's locals. The removed `@enter`, `@import`, and `@export` directives are errors.

Navigation uses `[[Label -> Target]]`, `[[Target]]`, and optional props such as `[[Inspect -> Card({enemy: $enemy})]]`. An action button uses `[[Label => actionName(args)]]`. `@view` and `@action` both accept pure-expr binding-pattern parameters; a view call renders nodes, while an action call runs effects in the current transaction. `@children` inserts the caller-provided body inside a view.

The document profile includes headings, paragraphs, lists, quotes, code fences, inline code, emphasis, strong text, strikeout, links, images, rules, styled spans, and extension containers. Raw HTML is not an executable host node.

```inkdown
[Danger]{.warning}

::: dialogue {speaker="Irene" mood="calm"}
You finally arrived.
:::

::: status {hp={{ $enemy.hp }} .warning}
The health value changed.
:::
```

Presentation tokens and extension records are semantic data. A renderer decides how to display them.

## Inkdown effects and source modules

```inkdown
---
imports:
  ./ui.mjs:
    default: Panel
    greet: =
exports: [heading]
---
@const heading = "Welcome"

@action collect({ bonus = 1 }) {
  @let [first, ...rest] = $values;
  @if (first > 0) {
    @do $total += first + bonus;
    @each (value of rest) {
      @do $total += value;
    }
  } @else {
    @do $total = 0;
  }
}

# {{ heading }} — {{ greet(props.name) }}
@Panel({ label: 'embedded' })
```

Effect bodies contain only `@do`, `@let`, `@call`, effect `@if`, and effect `@each`. They cannot contain JavaScript declarations, blocks, `import`, `export`, `await`, `yield`, or dynamic import. A source-position `@effect { ... }` is available for explicit ordered effects, primarily as a behavior-preserving migration target for compatibility dialects. Its presence makes that passage materialized so values before and after the effect retain source-order observations.

File YAML becomes static ESM linkage. Imports are visible to the primary initializer and passages; named exports must be definitely assigned directly in the primary environment and retain live-binding behavior. YAML linkage does not publish into a Story. JavaScript implementation belongs in an ordinary `.mjs`/`.js` module. Data/vendor builds reject module imports because they have no application module graph. Inkdown has no `@module` or `@script` escape hatch.

## Portable JavaScript subset

`pure-expr` parses every frontend into its restricted ESTree subset. Supported forms include scalars, arrays/objects, property access, arithmetic and boolean operators, conditionals, short-circuit and optional chains, templates, expression-bodied arrow functions, and calls. It also supplies binding-pattern and streaming scan APIs used by action/view parameters, `@let`, and iteration clauses. Effect expressions additionally enable identifier/member assignment and updates; gneh supplies effect control flow rather than a JavaScript statement parser.

Render expressions are evaluated with writes denied. Enter/action expressions commit writes into the enclosing Story transaction, so failed member writes, invalid JSON state, or later rendering errors roll back together. The parser still excludes statement-only JavaScript such as `new`, classes, dynamic import, generators, and block-bodied arrow functions; complex trusted behavior belongs in handwritten ESM or an explicit host binding.

## Karlowe profile

```karlowe
(set: $hp to 3)
(if: $hp > 0)[Alive.](else:)[Finished.]
(display: "Status")
(print: $hp + 1)
(link-goto: "Continue", "Next")
(link-repeat: "Heal")[(set: $hp to $hp + 1)]
(set: $double to (macro: num-type _n, [(output-data: _n * 2)]))
(set: $badge to (macro: str-type _label, [(output:)[Badge: (print: _label)]]))
(print: ($double: 4))
($badge: "ready")
```

Supported constructs include `set`/`put`, `print`, `if`/`else-if`/`else`, `display`, `link-goto`, reveal and repeat links, a basic `for`, `goto`, dropdown/checkbox bindings, mapped boolean/numeric/collection operations, `array`/`datamap`, `either`/`random`, possessive access and method calls, and portable `(macro:)` values ending in `(output-data:)` or `(output:)[...]`. `/` and `%` are independent operators in the new Karlowe lexer.

Karlowe prose follows Harlowe's own markup profile rather than the Inkdown/Markdown profile. Newlines become semantic line breaks; adjacent backslashes join lines; `#` headings, `*`/`0.` nested lists, horizontal rules, modal aligners (`==>`, `<==`, `<==>`, and mixed `=><=` forms), collapsing whitespace, grave-delimited verbatim text, and Harlowe's bold/italic/emphasis/strong/strike/superscript marks retain their source meanings. Harlowe's equal-precedence `and`/`or`, documented comparison precedence, inferred comparisons, inferred `it` within simple logical chains, and one-based computed possessive access are lowered before reaching the shared expression runtime.

Karlowe materializes a mounted passage in source order. Thus `(set:$x to 1)(print:$x)(set:$x to 2)(print:$x)` renders `12`; later unrelated state changes do not retroactively rewrite that materialized text. Reveal/repeat link bodies materialize when activated.

Anonymous hooks are structural containers. `|name>[...]` and `[...]<name|` create instance-local semantic regions; `replace`, `append`, and `prepend` can target a `?name` reference. Presentation-only changer composition supports color, font, text-style, size, border and corner radius through renderer-neutral extension data. `?sidebar` is a host portal rather than a global DOM selector.

Karlowe macro values use lexical capture. Assigning a callable to a `$` target publishes it into the transient Story registry; assigning to `_` retains it lexically. Neither closures nor temporary values are serialized. A value macro may compute through temporary locals before `(output-data:)`, but its value phase cannot write `$` story state or consume effect-time randomness. A view macro renders its hook body through the same callable runtime; explicit source-position effects there keep normal materialized semantics.

`enchant`, text/DOM queries, `click` target matching, scripts, arbitrary Harlowe macro bodies, and undocumented changer composition remain explicit errors. Host-owned operations such as portals and external navigation require an application callback. Karlowe does not recognize Inkdown directives. Built-in macro names follow Harlowe's ASCII-case-insensitive, internal-hyphen-optional lookup rule. Trusted build tooling can add portable lowerings through the caller-owned registry described in [Syntax and runtime extensions](EXTENSIONS.md); that is not a Harlowe runtime.

## Sugarcast profile

```sugarcast
<<set $hp = 3>>
<<if $hp > 0>>Alive.<<else>>Finished.<</if>>
<<include "Status">>
<<include "EnemyCard" {enemy: $enemy}>>
<<button "Heal">><<set $hp += 1>><</button>>
<<print $hp + 1>>

<<widget "badge">>Status: <<print _args[0]>><</widget>>
<<widget "panel" container>>[<<print _contents>>]<</widget>>
<<badge "ready">>
<<panel>>portable body<</panel>>
```

Supported constructs include `set`/`run`, `print`, `if`/`elseif`/`else`, `include`, `button`/`link`, a basic `for-of`, basic checkbox binding, SugarCube wiki-link headers, and parser-level aliases such as `is`/`isnot`/`and`/`or`/`not`. Link and button bodies are effect-only; their portable subset includes nested conditional and `for-of` control flow. Alias words inside strings are not rewritten.

Sugarcast prose likewise selects SugarCube markup rules: `!` headings, `*`/`#` nested lists, four-hyphen rules, blockquotes, triple-brace code, triple-quote and `<nowiki>` verbatim text, the six documented inline style pairs, C/TiddlyWiki/HTML comments, hard line breaks, SugarCube's whitespace-tolerant line continuations, `$$` escaping, and chained naked-variable property/index access. `<<=>>` and `<<->>` are both print aliases. These are represented as renderer-neutral content nodes; executable HTML and browser-owned wiki features remain outside the portable profile.

Sugarcast also materializes in source order. Writes are explicit IR effect nodes, not hoisted entry code, so output before and after a write observes the corresponding state.

A normal `<<widget "name">>` publishes a Story-global view when its declaration is evaluated, including inside a capture, and closes over that capture. `<<widget local "name">>` instead creates a lexical view. `_args` is an array of evaluated call arguments. A `container` widget may render its caller body with `<<print _contents>>` or `<<= _contents>>`. Widget bodies may use the supported Sugarcast constructs, including state-writing effect macros; they do not receive SugarCube's `MacroContext`, shadow store, DOM output object, or JavaScript callback APIs.

Range and C-style loops, `<<capture>>` shadowing, scripts, source-level `Macro.add`, Wikifier, jQuery, and DOM macros are outside the profile. Widget names must be literal strings and definitions are declarative rather than runtime mutations. Sugarcast does not recognize Inkdown directives. Trusted build tooling may register additional IR lowerings without enabling those runtime APIs.

## Migration

`gneh migrate` converts only constructs with a behavior-preserving Inkdown spelling. Source-order effects become `@effect` blocks. Compatibility-only interactions, controls, portals, and region changes still fail with `MIGRATION_UNREPRESENTABLE`; they are never emitted as false-success Inkdown. Migration means “same observable gneh semantics after lowering,” not “complete source-engine behavior preserved.”
