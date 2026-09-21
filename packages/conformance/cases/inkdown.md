# Inkdown executable language surface

These examples exercise Inkdown as a complete document, including its Markdown prose, expressions, declarations, control flow, reusable views, effects, regions, links, and module setup.

## Markdown prose

### Inline and block markup

````inkdown
:: Start [start]
# Heading

**strong** *emphasis* ~~strike~~ `code` [link](https://example.com) ![alt](image.png)

> quote

- one
  - nested

1. first

---

```js
const value = 1;
```
````

```text
Headingstrong emphasis strike code link quoteonenestedfirstconst value = 1;
```

--------

### Escapes, spans, and extension containers

```inkdown
:: Start [start]
Escaped \*star\* and two spaces
after.

[label]{#target .quiet title="note"}

::: panel #card .wide count={{ $count }}
inside
:::
```

```json
{ "state": { "count": 2 } }
```

```text
Escaped *star* and two spaces
after.labelinside
```

## Values and control flow

### Expressions, bindings, conditions, and loops

```inkdown
:: Start [start]
@let $total = 2
@const offset = 1
@do $total += offset
@if ($total === 3) {yes} @else {no}
@each (item of $items; key item.name) { {{ item.name }}={{ item.value + $total }}; }Done
```

```json
{
  "state": {
    "total": 0,
    "items": [
      { "name": "a", "value": 1 },
      { "name": "b", "value": 2 }
    ]
  }
}
```

```text
yes a=4;  b=5; Done
```

--------

### Else-if chains select one branch

```inkdown
:: Start [start]
@if ($score > 10) {high} @else if ($score > 5) {middle} @else {low}
```

```json
{ "state": { "score": 7 } }
```

```text
middle
```

--------

### Views, defaults, rest parameters, and children

```inkdown
:: Start [start]
@view Card({label = "untitled"}, ...suffix) {[{{ label }}|{{ suffix.join("") }}|@children]}
@Card({label: "Ready"}, "!", "?") {inside}
```

```text
[Ready|!?|inside]
```

--------

### Nested views capture their invocation environment

```inkdown
:: Start [start]
@view Outer(value) {
  @view Inner() {{{ value }}}
  @Inner()
}
@Outer("captured")
```

```text
captured
```

## Effects and interaction

### Native views react after actions

```inkdown
:: Start [start]
@action hit { @do $hp -= 1; }
@if ($hp > 0) {HP: {{ $hp }} [[Hit => hit]]} @else {Dead}
[[Next->End]]
:: End
End
```

```json
{ "state": { "hp": 1 }, "steps": [{ "activate": "Hit" }], "expect": { "state": { "hp": 0 } } }
```

```text
DeadNext
```

--------

### Actions compose calls, conditionals, loops, and binding patterns

```inkdown
:: Start [start]
@action add(amount) { @do $total += amount; }
@action collect({bonus = 2}) {
  @let [first, ...rest] = $values;
  @if (first > 0) {
    @call add(first + bonus);
    @each (value of rest) { @call add(value); }
  } @else { @do $total = -1; }
}
Total: {{ $total }} [[Collect => collect({})]]
```

```json
{ "state": { "total": 0, "values": [1, 3, 4] }, "steps": [{ "activate": "Collect" }] }
```

```text
Total: 10 Collect
```

--------

### Source-order effect materialization

```inkdown
:: Start [start]
before {{ $value }}
@effect { @do $value += 1; }
after {{ $value }}
```

```json
{ "state": { "value": 0 } }
```

```text
before 0after 1
```

--------

### Regions react without changing story state

```inkdown
:: Start [start]
@action reveal { @do $shown = true; }
@region notice { @if ($shown) {Ready} @else {Waiting} }
[[Reveal => reveal]]
```

```json
{ "state": { "shown": false }, "steps": [{ "activate": "Reveal" }] }
```

```text
ReadyReveal
```

## Documents and navigation

### Passage navigation

```inkdown
:: Start [start]
[[Continue->End]]
:: End
Arrived
```

```json
{ "steps": [{ "activate": "Continue" }] }
```

```text
Arrived
```

--------

### Setup publishes reusable views

```inkdown
---
setup: [Definitions]
---
:: Definitions
@view Badge(label) {**{{ label }}**}
@publish { Badge }
:: Start [start]
@Badge("Ready")
```

```text
Ready
```

--------

### Canonical XML projection

```inkdown
:: Start [start]
**bold**
```

```xml
<gneh><paragraph key="&quot;i0:root/17:0&quot;"><strong key="&quot;i0:root/17:0/17:0&quot;"><text key="&quot;i0:root/17:0/17:0/19:0&quot;">bold</text></strong></paragraph></gneh>
```
