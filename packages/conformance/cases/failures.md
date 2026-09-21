# Rejected source and lifecycle operations

These cases make important source-module and Story-boundary failures executable. Their text output is the exact
compiler diagnostic or runtime error rather than a renderer projection.

## Primary initializer

### Bare primary render output has no host

```inkdown
Bare output
:: Start [start]
start
```

```json
{ "expect": { "error": true } }
```

```text
PARSE_ERROR: Bare render output is not allowed in the primary initializer.
```

--------

### Story state is unavailable during module initialization

```inkdown
@let $value = 1
:: Start [start]
start
```

```json
{ "expect": { "error": true } }
```

```text
PRIMARY_STATE: Primary declarations cannot bind Story state.
```

## Lexical declarations

### A passage is not an implicit view callable

```inkdown
:: Start [start]
@Card()
:: Card
passage body
```

```json
{ "expect": { "error": true } }
```

```text
PASSAGE_AS_VIEW: Card is a passage, not a view callable. Declare an explicit view with @view.
```

--------

### Const cannot declare Story state

```inkdown
:: Start [start]
@const $value = 1
```

```json
{ "expect": { "error": true } }
```

```text
EFFECT_BINDING: @const cannot declare persistent Story state.
```

--------

### Direct lexical redeclaration fails

```inkdown
:: Start [start]
@let value = 1
@const value = 2
```

```json
{ "expect": { "error": true } }
```

```text
Duplicate lexical declaration: value
```

## Setup restrictions

### Setup cannot navigate

```karlowe
---
setup: [Initialize]
---
:: Initialize
(go-to: "End")
:: Start [start]
start
:: End
end
```

```json
{ "expect": { "error": true } }
```

```text
Setup passages cannot navigate.
```

--------

### Duplicate canonical passage IDs fail compilation

```inkdown
:: First [start] {"id":"same"}
one
:: Second {"id":"same"}
two
```

```json
{ "expect": { "error": true } }
```

```text
DUPLICATE_ID: Duplicate passage id: same
```
