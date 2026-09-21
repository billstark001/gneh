# Story lifecycle and source-module boundaries

These cases exercise passage identity, navigation props, history, setup reconstruction, and the transient
Story-global registry described by ADR 0002.

## Passage identity and navigation

### Canonical IDs own routes and props

```inkdown
:: Start [start]
start
:: Display name {"id":"RealCard","params":["label"]}
{{ label }}
```

```json
{
  "steps": [{ "navigate": { "target": "RealCard", "props": { "label": "from props" } } }],
  "expect": { "current": "RealCard" }
}
```

```text
from props
```

--------

### Save and load restore route props

```inkdown
:: Start [start]
start
:: Card {"params":["label"]}
{{ label }}
:: End
end
```

```json
{
  "steps": [
    { "navigate": { "target": "Card", "props": { "label": "remembered" } } },
    { "save": "card" },
    { "navigate": { "target": "End" } },
    { "load": "card" }
  ],
  "expect": { "current": "Card" }
}
```

```text
remembered
```

## History

### Undo and redo restore persistent state

```inkdown
:: Start [start]
@action add { @do $count += 1; }
Count={{ $count }} [[Add => add]]
```

```json
{
  "state": { "count": 0 },
  "steps": [{ "activate": "Add" }, { "undo": true }, { "redo": true }],
  "expect": { "state": { "count": 1 }, "canUndo": true, "canRedo": false }
}
```

```text
Count=1 Add
```

--------

### Undo does not rewind Story-global registrations

```inkdown
:: Start [start]
@action enable { @do $enabled = true; }
@if ($enabled) {
  @view Added() {added}
  @publish { Added }
  enabled
} @else {disabled}
[[Enable => enable]]
```

```json
{
  "state": { "enabled": false },
  "steps": [{ "activate": "Enable" }, { "undo": true }],
  "expect": { "state": { "enabled": false }, "registrations": ["Added"], "canRedo": true }
}
```

```text
disabledEnable
```

## Setup reconstruction

### Load reruns setup after restoring persistent state

```inkdown
---
setup: [Definitions]
---
:: Definitions
@do $setups += 1
@view Marker() {setup}
@publish { Marker }
:: Start [start]
@action add { @do $count += 1; }
setups={{ $setups }} count={{ $count }} @Marker() [[Add => add]]
```

```json
{
  "state": { "setups": 0, "count": 0 },
  "steps": [{ "save": "initial" }, { "activate": "Add" }, { "load": "initial" }],
  "expect": { "state": { "setups": 2, "count": 0 }, "registrations": ["Marker"] }
}
```

```text
setups=2 count=0 setupAdd
```

--------

### Reset restores initial state and reruns setup

```inkdown
---
setup: [Initialize]
---
:: Initialize
@do $setups += 1
:: Start [start]
@action add { @do $count += 1; }
setups={{ $setups }} count={{ $count }} [[Add => add]]
```

```json
{
  "state": { "setups": 0, "count": 0 },
  "steps": [{ "activate": "Add" }, { "reset": true }],
  "expect": { "state": { "setups": 1, "count": 0 }, "canUndo": false, "canRedo": false }
}
```

```text
setups=1 count=0 Add
```

--------

### Setup closures retain scoped temporaries

```inkdown
---
setup: [Definitions]
---
:: Definitions
@const label = "captured"
@view Show() {{{ label }}}
@publish { Show }
:: Start [start]
@Show()
```

```json
{ "expect": { "registrations": ["Show"] } }
```

```text
captured
```

--------

### Setup passages remain navigable passages

```inkdown
---
setup: [Definitions]
---
:: Definitions
Definitions route
:: Start [start]
Start route
```

```json
{
  "steps": [{ "navigate": { "target": "Definitions" } }],
  "expect": { "current": "Definitions" }
}
```

```text
Definitions route
```

## Transient registry

### Registrations survive a branch that stops rendering

```inkdown
:: Start [start]
@action disable { @do $enabled = false; }
@if ($enabled) {
  @view Conditional() {conditional}
  @publish { Conditional }
  shown
} @else {hidden}
[[Disable => disable]]
```

```json
{
  "state": { "enabled": true },
  "steps": [{ "activate": "Disable" }],
  "expect": { "state": { "enabled": false }, "registrations": ["Conditional"] }
}
```

```text
hiddenDisable
```

--------

### Loading clears conditional registrations not reconstructed by setup or render

```inkdown
:: Start [start]
@action enable { @do $enabled = true; }
@if ($enabled) {
  @view Conditional() {conditional}
  @publish { Conditional }
  shown
} @else {hidden}
[[Enable => enable]]
```

```json
{
  "state": { "enabled": false },
  "steps": [{ "save": "clean" }, { "activate": "Enable" }, { "load": "clean" }],
  "expect": { "state": { "enabled": false }, "registrations": [] }
}
```

```text
hiddenEnable
```

--------

### Later setup registration replaces an earlier name

```inkdown
---
setup: [First, Second]
---
:: First
@view Card() {first}
@publish { Card }
:: Second
@view Card() {second}
@publish { Card }
:: Start [start]
@Card()
```

```json
{ "expect": { "registrations": ["Card"] } }
```

```text
second
```

## Dialect-specific closure chains

### Karlowe invocation arguments shadow captures

```karlowe
:: Start [start]
(set: _value to 2)(set: $identity to (macro: num-type _value, [(output-data: _value)]))(print: ($identity: 4))
```

```text
4
```

--------

### Local Sugarcast widgets do not enter the Story registry

```sugarcast
:: Start [start]
<<widget local "localBadge">>local<</widget>><<localBadge>>
```

```json
{ "expect": { "registrations": [] } }
```

```text
local
```

--------

### Sugarcast widgets retain a nested definition capture

```sugarcast
:: Start [start]
<<if true>><<set _label = "nested">><<widget "captured">><<print _label>><</widget>><</if>><<captured>>
```

```json
{ "expect": { "registrations": ["captured"] } }
```

```text
nested
```
