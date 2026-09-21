# GNEH language conformance

This private workspace package owns end-to-end language examples which compile a complete source document, construct a `Story`, execute optional interactions, and compare the final renderer projection. Parser, CST, IR-shape, diagnostics, compiler-emission, and runtime-kernel unit tests remain in their owning packages.

## Specification files

Cases live in `cases/*.md` and are ordinary Markdown with this hierarchy:

- one `#` heading states the file's purpose;
- each `##` heading names a related test group;
- each `###` heading starts one test case;
- `####` and deeper headings, plus normal Markdown paragraphs, explain intent and are ignored by the runner; and
- a line containing four or more hyphens separates test cases.

Each case contains exactly one input fence whose info string is `inkdown`, `karlowe`, or `sugarcast`, and exactly one output fence whose info string is `xml` or `text`. An optional `json` fence configures the initial state, explicit entry, and operation sequence:

````markdown
### A changing counter

```json
{ "state": { "count": 0 }, "steps": [{ "activate": "Add" }] }
```

```inkdown
:: Start [start]
@action add() { @do $count += 1; }
[[Add => add()]]
{{ $count }}
```

```text
Add1
```
````

`steps` executes operations in order. A step may:

- activate a visible button or choice with `{ "activate": "Label" }`;
- change a visible control with `{ "change": { "target": "Label", "value": true } }`;
- navigate with `{ "navigate": { "target": "Passage", "props": {} } }`;
- save or load an in-case named checkpoint with `{ "save": "name" }` or `{ "load": "name" }`;
- reset the Story with `{ "reset": true }`; or
- request history traversal with `{ "undo": true }` or `{ "redo": true }`.

`entry` selects the initial canonical passage ID. An `expect` object may assert final `state`, `current`, sorted Story-global `registrations`, `canUndo`, and `canRedo` in addition to the renderer output. `{ "expect": { "error": true } }` instead expects compilation or execution to fail and compares its diagnostic or error with a `text` output fence. Named saves exist only during one case. The runner rejects unknown configuration fields, malformed steps, missing saves, and missing interactive targets.

Fence length is significant: a closing fence must use the opening character and at least the opening length. Use a longer outer fence when an Inkdown input contains Markdown fences:

`````markdown
````inkdown
```js
const example = true;
```
````
`````

This prevents headings, separators, and shorter fences inside an input document from being interpreted as conformance structure.

## Robustness smoke tests

`test/robustness.test.ts` complements the authored specifications with small deterministic generated suites. Fixed seeds exercise malformed input across every dialect and CST entry point, require metadata failures to remain typed, and compile and render generated valid stories in all three dialects. The checked-in counts are intentionally bounded so normal conformance runs stay fast; concrete failures discovered by larger exploratory fuzzing belong in an owning package's regression tests or in an authored conformance case.

## Output formats

`text` uses `renderText()` and is useful for semantic results where structure is irrelevant. `xml` uses the canonical `XMLRenderer` and covers node kinds, sorted JSON-encoded attributes, stable keys, and callback handles. Expected output is exact; whitespace inside fences is data.

## External examples

Karlowe and Sugarcast cases adapted from the [official Twine Cookbook](https://twinery.org/cookbook/) link the exact recipe near the relevant group. Adaptations remove special passages or macros which are outside GNEH's documented portable subset, while retaining the behavior under test. Inkdown examples are authored in this repository and aim to cover its complete native syntax surface.
