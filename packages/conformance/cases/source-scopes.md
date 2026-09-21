# Source-module and Story scope behavior

These executable cases cover the scope and lifetime rules accepted by [`0002-source-modules-and-story-manifests.md`](../../../docs/decisions/0002-source-modules-and-story-manifests.md). Static ESM linkage and emitted live bindings remain compiler tests because they execute generated JavaScript rather than a `Story`; this file owns the observable language/runtime boundary.

## Inkdown lexical scope

### Invocation arguments shadow captured bindings

```inkdown
:: Start [start]
@const label = "outer"
@view Show(label) {{{ label }}}
@Show("inner") / {{ label }}
```

```text
inner/ outer
```

--------

### Loop callables retain their iteration scope

```inkdown
:: Start [start]
@each (item of [{id: "a", label: "A"}, {id: "b", label: "B"}]; key item.id) {
  @action choose() { @do $picked = item.id; }
  [[Choose {{ item.label }} => choose()]]
}
:: Result
{{ $picked }}
```

```json
{
  "state": { "picked": "" },
  "steps": [{ "activate": "Choose B" }, { "navigate": { "target": "Result" } }],
  "expect": { "state": { "picked": "b" }, "current": "Result" }
}
```

```text
b
```

--------

### Publish-star is a source-order snapshot

```inkdown
---
setup: [Definitions]
---
:: Definitions
@view First() {First}
@publish *
@view Later() {Later}
:: Start [start]
@First()
```

```json
{ "expect": { "registrations": ["First"] } }
```

```text
First
```

--------

### Unbounded setup views publish at their container boundary

```inkdown
---
setup: [Definitions]
---
:: Definitions
@view Greeting()
Hello
:: Start [start]
@Greeting()
```

```json
{ "expect": { "registrations": ["Greeting"] } }
```

```text
Hello
```

## Setup lifecycle

### Setup passages execute left to right before entry

```inkdown
---
setup: [First, Second]
---
:: First
@do $trace += "A"
:: Second
@do $trace += "B"
:: Start [start]
{{ $trace }}
```

```json
{ "state": { "trace": "" }, "expect": { "state": { "trace": "AB" } } }
```

```text
AB
```

## Karlowe lexical scope

### Macros close over their definition environment

```karlowe
:: Start [start]
(set: _factor to 2)(set: $multiply to (macro: num-type _value, [(output-data: _value * _factor)]))(print: ($multiply: 4))
```

```text
8
```

## Sugarcast capture scope

### Registered widgets retain definition temporaries

```sugarcast
:: Start [start]
<<set _label = "captured">><<widget "show">><<print _label>><</widget>><<show>>
```

```json
{ "expect": { "registrations": ["show"] } }
```

```text
captured
```
