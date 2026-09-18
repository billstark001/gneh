# gneh 0.1 language and container profile

This document describes the implemented portable profile. It is not the official
Harlowe or SugarCube specification and does not claim full CommonMark or YAML 1.2.

## Shared source container

Every dialect uses the same `@gneh/source` passage splitter:

```text
:: Passage name [tag1 tag2] {"position":"100,200","custom":true}
```

A file without a Twee header is one passage. Its ID comes from front matter `id` or
from the filename. A multi-passage file may have file front matter before the first
header and passage front matter immediately after each header.

```inkdown
---
tags: [book]
layout:
  density: loose
---
:: Card [component] {"layout":{"tone":"quiet"},"position":"1,2"}
---
id: EnemyCard
params: [enemy]
layout:
  density: compact
---
{{ enemy.name }}
```

Precedence is file front matter, then header JSON, then passage front matter. Objects
merge recursively, arrays replace earlier values, and `tags` is a stable union. The
example keeps the display name `Card` while using the runtime ID `EnemyCard`.

Front matter is a JSON-compatible YAML subset: indented objects, scalar lists, flow
arrays/objects, strings, finite numbers, booleans, null, comments, and block strings.
Anchors, aliases, tags, implicit dates, tab indentation, and object-list shorthand
are rejected. Duplicate or prototype-polluting keys are errors.

Code fences do not open new Twee passages. CRLF and Unicode source offsets are
preserved. Header brackets can be escaped.

## Shared semantics

- `$hp` in prose and `{{ $hp }}` produce the same value node.
- Complex access is explicit: `{{ $player.hp }}`. Bare `$player.hp` interpolates only
  `$player` and leaves `.hp` as prose.
- Inline code and `\$hp` remain literal. `$1.50` is currency, not a state reference.
- `$name` reads persistent story state. Plain names resolve props, loop locals, or
  module bindings. `props.enemy` is also available.
- Render expressions cannot mutate. Writes occur during enter or action effects.
- State must remain finite JSON data; functions, DOM nodes, cycles, and unsafe keys
  are rejected.
- Effect-time randomness uses a seeded PRNG stored in snapshots. Render-time
  randomness is rejected.

These semantics belong to gneh. Familiar surface syntax does not import the source
engine's complete value, history, or rendering model.

## Inkdown

```inkdown
@enter {
  $visits += 1;
}

@action attack {
  $enemy.hp -= 1;
  $log.push({ id: $log.length, text: 'attack' });
}

@if ($enemy.hp > 0) {
  [[Attack => attack]]
} @else {
  [[Continue -> Hallway]]
}

@for (const item of $inventory; key item.id) {
  - {{ item.name }}
}

@EnemyCard({ enemy: $enemy })

@region notification {
  No messages.
}
```

`@slot` is a synonym for `@region`. Loop keys must be unique strings or numbers.
Without an explicit key, gneh uses `item.id` when available and otherwise the index,
with a warning. `@enter`, `@action`, and `@module` are top-level declarations and may
not be hidden in a reactive branch.

Navigation uses `[[Label -> Target]]`, `[[Target]]`, and optional props such as
`[[Inspect -> Card({enemy: $enemy})]]`. An action button uses
`[[Label => actionName]]`.

The document profile includes headings, paragraphs, lists, quotes, code fences,
inline code, emphasis, strong text, strikeout, links, images, rules, styled spans,
and extension containers. Raw HTML is not an executable host node.

```inkdown
[Danger]{.warning}

::: dialogue {speaker="Irene" mood="calm"}
You finally arrived.
:::

::: status {hp={{ $enemy.hp }} .warning}
The health value changed.
:::
```

Presentation tokens and extension records are semantic data. A renderer decides
how to display them.

## Inkdown modules

```inkdown
@module {
  import Panel from './Panel.mjs';
  const prefix = 'Hello';
  export function greet(name) { return prefix + ' ' + name; }
}

# {{ greet(props.name) }}
@Panel({ label: 'embedded' })
```

A source file has at most one shared `@module`. It uses JavaScript ESM grammar, not
TypeScript syntax. Default export and compiler-reserved names are unavailable
because the document owns those exports. Data/vendor builds reject modules; Vite or
CLI ESM compilation is required.

## Portable JavaScript subset

Acorn parses expressions before gneh lowers them to a closed AST. Supported forms
include scalars, arrays/objects, property access, arithmetic and boolean operators,
conditionals, short-circuit and optional chains, templates, expression-bodied arrow
functions, and approved calls. Actions add assignment, local declarations, calls,
`if`, and `for-of`.

The portable AST excludes `new`, classes, dynamic import, `eval`, `await`, generators,
prototype access, and block-bodied arrow functions. Complex trusted behavior belongs
in handwritten ESM.

## Karlowe profile

```karlowe
(set: $hp to 3)
(if: $hp > 0)[Alive.](else:)[Finished.]
(display: "Status")
(print: $hp + 1)
(link-goto: "Continue", "Next")
(link-repeat: "Heal")[(set: $hp to $hp + 1)]
```

Supported constructs include `set`/`put`, `print`, `if`/`else-if`/`else`, `display`,
`link-goto`, reveal and repeat links, a basic `for`, `goto`, dropdown/checkbox
bindings, mapped boolean/numeric/collection operations, `array`/`datamap`,
`either`/`random`, possessive access and method calls. `/` and `%` are independent
operators in the new Karlowe lexer.

Karlowe materializes a mounted passage in source order. Thus
`(set:$x to 1)(print:$x)(set:$x to 2)(print:$x)` renders `12`; later unrelated state
changes do not retroactively rewrite that materialized text. Reveal/repeat link
bodies materialize when activated.

Anonymous hooks are structural containers. `|name>[...]` and `[...]<name|` create
instance-local semantic regions; `replace`, `append`, and `prepend` can target a
`?name` reference. Presentation-only changer composition supports color, font,
text-style, size, border and corner radius through renderer-neutral extension data.
`?sidebar` is a host portal rather than a global DOM selector.

`enchant`, text/DOM queries, `click` target matching, source-defined executable
macros, scripts, and undocumented changer composition remain explicit errors. Host-owned
operations such as portals and external navigation require an application callback.
Karlowe does not recognize Inkdown directives. Macro names follow Harlowe's
ASCII-case-insensitive, internal-hyphen-optional lookup rule. Trusted build tooling
can add portable lowerings through the caller-owned registry described in
[Syntax and runtime extensions](EXTENSIONS.md); that is not a Harlowe macro runtime.

## Sugarcast profile

```sugarcast
<<set $hp = 3>>
<<if $hp > 0>>Alive.<<else>>Finished.<</if>>
<<include "Status">>
<<include "EnemyCard" {enemy: $enemy}>>
<<button "Heal">><<set $hp += 1>><</button>>
<<print $hp + 1>>
```

Supported constructs include `set`/`run`, `print`, `if`/`elseif`/`else`, `include`,
`button`/`link`, a basic `for-of`, basic checkbox binding, and parser-level aliases such as
`is`/`isnot`/`and`/`or`/`not`. Alias words inside strings are not rewritten.

Sugarcast also materializes in source order. Writes are explicit IR effect nodes,
not hoisted entry code, so output before and after a write observes the corresponding
state. It remains a compatibility profile, not a SugarCube widget engine.

Range and C-style loops, widget and capture scope semantics, scripts, source-level `Macro.add`,
Wikifier, jQuery, and DOM macros are outside the profile. Sugarcast does not
recognize Inkdown directives. Trusted build tooling may register additional IR
lowerings without enabling those runtime APIs.

## Migration

`gneh migrate` converts only constructs with a behavior-preserving Inkdown spelling.
Compatibility-only source-order effects, interactions, controls, portals, and region
changes fail with `MIGRATION_UNREPRESENTABLE`; they are never emitted as
false-success Inkdown. Migration means “same observable gneh semantics after
lowering,” not “complete source-engine behavior preserved.”
