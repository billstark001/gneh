# Karlowe compatibility design

Karlowe is a Harlowe source frontend for gneh, not a second Harlowe runtime. Its compatibility boundary is observable story behavior that can be expressed without assuming a DOM, Twine's passage elements, or Harlowe's private macro protocol.

## Frontend pipeline

```text
source
  -> lossless Karlowe lexer (names, spans, raw expression text)
  -> registry-independent Karlowe CST (including unknown macros and nested hooks)
  -> portable expression parser
  -> caller-owned CST-to-IR lowering
  -> shared Story IR
  -> shared runtime and renderer protocol
```

The lexer is a new single-pass scanner. It owns balanced macros, hooks, strings, comments, verbatim spans, and the `[[`/`[[[` ambiguity, but deliberately does not classify expression operators. This keeps `/` and `%` distinct and prevents markup token rules from becoming expression semantics. The small attributed Pratt parser is retained only for Karlowe precedence and lowers directly into the same restricted ESTree subset used by `pure-expr`.

## Semantic compatibility classes

| Class | Karlowe behavior | Boundary |
| --- | --- | --- |
| Flow | `set`, `put`, `print`, conditions, loops, display and navigation | Materialized once per mounted passage, in source order |
| Hooks | anonymous hooks and prefix/suffix named hooks | Structural nodes and instance-local regions, never global selectors |
| Interaction | `link`, `link-repeat`, `link-goto`, dropdown and checkbox | Semantic View events; no synthesized DOM queries |
| Presentation | color, font, text style, size, border and radius composition | Renderer-neutral extension data interpreted by a renderer |
| Region change | `replace`, `append`, `prepend` with `?name` | Only semantic named-hook references; missing regions are errors |
| Host effect | sidebar portal, external navigation, restart, save/load helpers | Explicit `StoryOptions.host`; unavailable operations fail; portals may return cleanup |

Harlowe passage output is materialized because Harlowe wikifies source in order. Inkdown remains reactive. The policy is an IR field rather than a dialect check in the runtime, so a future frontend can select either model without coupling packages. Bound controls are intentionally live and continue to read current state.

## Explicit exclusions

Karlowe's portable source profile accepts `(macro:)` values whose body is portable effect code followed by `(output-data:)` or `(output:)[...]`. It rejects constructs whose identity depends on Harlowe's rendered document: text selectors, `enchant`, `click`/`click-replace` matching, arbitrary changer attachment, timers/live hooks, arbitrary Harlowe macro protocols, scripts, and private dialog/file APIs. This is not a ban on implementing the visible effect in a gneh application. Root-scoped event delegation, browser capabilities, post-render decoration, portals, and extension renderers can provide those effects without exposing ambient DOM authority to portable story source; [DOM behavior and host integration](DOM_BEHAVIORS.md) demonstrates the boundary and the story-code bridge. Trusted compiler configuration may register a new lowering that satisfies the criteria below; that does not install a Harlowe runtime. Adding one of these to the portable language requires a new semantic IR operation or an explicit host capability; implementing it as an implicit global `querySelector`, hidden global state, or silent fallback is outside the portable project boundary.

An extension is suitable for the portable profile when all of the following hold:

1. its observable result can be described without an HTML element identity;
2. it has deterministic source-order, transaction, history, and disposal behavior;
3. unsupported renderers can detect the required capability;
4. both interpreted IR and generated ESM can preserve the same result;
5. real sample syntax and a focused regression test cover the lowering.

## Performance and maintenance policy

- Markup scanning is linear over consumed source and retains offsets in a compact CST that is independent of the semantic lowering registry.
- Lowering dispatch normalizes once at the frontend boundary and uses a caller-owned `Map`; built-ins and extensions share the same constant-time lookup path.
- Materialized values use one frame-local `Map`; there is no signal graph or generic Harlowe AST interpreter.
- Named-hook changes address runtime regions directly and never scan the DOM.
- The runtime still performs transaction-level view recomputation, allowing the existing keyed renderer to preserve node identity.
- Dialect-only syntax stays in `@gneh/karlowe`; core additions are small semantic operations that another frontend or renderer can implement independently.

The `gneh-ws` audit is a staged static check, not a full playthrough. It separately reports `structured`, `declared`, `resolved`, `lowered`, and `runtime-satisfied` passage counts. At the current revision, the three Karlowe samples contain 1,530 passages: 1,529 build a CST and 1,522 pass declaration, resolution, lowering, and runtime gates. The remainder contain deliberately excluded DOM/custom macros or one malformed string. Torean Role Finder is 124/124 at every stage.

The Degrees of Lewdity 0.5.12.12 stress sample contains 16,087 passages and inventories 5,005 static widget names plus 220 script-registered names. Static widgets now participate in Sugarcast's portable view resolution; script registrations remain inventory only. Audit totals are sample- and revision-specific, so generated audit output—not a frozen count in this document—is authoritative. The stress sample makes the boundary measurable; it is not a claim of SugarCube gameplay compatibility.
