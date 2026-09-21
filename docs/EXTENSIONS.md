# Syntax lowerings and runtime extensions

gneh deliberately separates two extension boundaries:

```text
dialect CST -- trusted lowering --> semantic IR -- RuntimeExtension --> View[] / effect
```

A `MacroLoweringRegistry` is build-time configuration. It maps a dialect CST node to renderer-neutral IR and never participates in story execution. A `RuntimeExtension` is application-owned runtime behavior invoked by an explicit `invoke` IR node. Neither API is a runtime SugarCube macro engine or a Harlowe custom-macro runtime.

## CST-to-IR lowerings

Every frontend owns its concrete syntax and built-in lowerings. Registries are caller-owned, have no process-global state, and are captured by the explicit frontend registration passed to the compiler, vendor helpers, or Vite plugin.

```ts
import { createInkdownLowerings, inkdown } from '@gneh/inkdown';
import { gneh } from '@gneh/vite';

const lowerings = createInkdownLowerings();

lowerings.register('build-name', ({ node, parser, base }) => ({
  nodes: [
    {
      type: 'text',
      value: 'nightly',
      span: parser.span(base + node.start, base + node.headEnd),
    },
  ],
  end: node.headEnd,
}));

export default {
  plugins: [gneh({ dialects: [inkdown(lowerings)] })],
};
```

`createKarloweLowerings()` and `createSugarcastLowerings()` expose the same trusted lowering boundary. `register()` rejects accidental canonical-name collisions; `clone()` creates an independently mutable registry. Inkdown names are exact, Karlowe names follow Harlowe's ASCII-case-insensitive/internal-hyphen-optional rule, and Sugarcast names are ASCII-case-insensitive.

Karlowe and Sugarcast first preserve unknown macro syntax in dialect-owned CST. Known names are lowered by their built-in registry. Unknown names lower to a generic `invoke` node such as `karlowe/badge` or `sugarcast/badge`; they do not make parsing fail and they never execute source text.

## Runtime extensions

An application must declare every generic invocation to the compiler and install an implementation in the runtime:

```ts
const result = compileProject(sources, {
  dialects: [sugarcast()],
  runtimeExtensionIds: ['sugarcast/badge'],
});

const story = new Story(result.story, {
  runtimeExtensions: {
    'sugarcast/badge': {
      phases: ['view'],
      invoke({ args, children }) {
        return {
          kind: 'extension:badge',
          attrs: { tone: args[0] },
          children: children(),
        };
      },
    },
  },
});
```

The compiler emits `RUNTIME_EXTENSION_UNDECLARED` when an invocation has no declared ID. The runtime separately rejects missing implementations and phase mismatches. This makes builds auditable without coupling the parser or core IR to DOM behavior.

## Source-defined callables and host extensions

Inkdown `@action`/`@view`, Sugarcast `<<widget>>`, and portable Karlowe `(macro:)` values lower to the shared phase-typed callable IR. These are story declarations, not extension registration APIs: they receive lexical or story capture according to their dialect, but no `MacroContext`, DOM output, or JavaScript callback. `Macro.add`, arbitrary Harlowe macro protocols, and new executable host behavior still use the explicit `invoke`/`RuntimeExtension` boundary instead of creating a second privileged runtime. Scripts, DOM queries, and runtime code injection remain outside the portable profiles.

The story ABI remains version 1. It was never a production ABI, so the old registry option and type names are removed rather than retained as aliases.

For DOM-specific results, keep the runtime extension renderer-neutral and return an `extension:<name>` View, then install the matching application-owned extension renderer. The complete story-to-DOM bridge is shown in [DOM behavior and host integration](DOM_BEHAVIORS.md).
