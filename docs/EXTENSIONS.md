# Syntax lowerings and runtime extensions

gneh deliberately separates two extension boundaries:

```text
dialect CST -- trusted lowering --> semantic IR -- RuntimeExtension --> View[] / effect
```

A `MacroLoweringRegistry` is build-time configuration. It maps a dialect CST node
to renderer-neutral IR and never participates in story execution. A
`RuntimeExtension` is application-owned runtime behavior invoked by an explicit
`invoke` IR node. Neither API is a SugarCube widget engine or a Harlowe custom-macro
runtime.

## CST-to-IR lowerings

Every frontend owns its concrete syntax and built-in lowerings. Registries are
caller-owned, have no process-global state, and may be passed through
`compileSource`, `compileProject`, `parseSource`, the dialect parsers, vendor helpers,
or the Vite plugin.

```ts
import { createInkdownLowerings } from '@gneh/inkdown';
import { gneh } from '@gneh/vite';

const inkdown = createInkdownLowerings();

inkdown.register('build-name', ({ node, parser, base }) => ({
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
  plugins: [gneh({ lowerings: { inkdown } })],
};
```

`createKarloweLowerings()` and `createSugarcastLowerings()` expose the same trusted
lowering boundary. `register()` rejects accidental canonical-name collisions;
`clone()` creates an independently mutable registry. Inkdown names are exact,
Karlowe names follow Harlowe's ASCII-case-insensitive/internal-hyphen-optional rule,
and Sugarcast names are ASCII-case-insensitive.

Karlowe and Sugarcast first preserve unknown macro syntax in dialect-owned CST.
Known names are lowered by their built-in registry. Unknown names lower to a generic
`invoke` node such as `karlowe/badge` or `sugarcast/badge`; they do not make parsing
fail and they never execute source text.

## Runtime extensions

An application must declare every generic invocation to the compiler and install an
implementation in the runtime:

```ts
const result = compileProject(sources, {
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

The compiler emits `RUNTIME_EXTENSION_UNDECLARED` when an invocation has no declared
ID. The runtime separately rejects missing implementations and phase mismatches.
This makes builds auditable without coupling the parser or core IR to DOM behavior.

## Deferred source-defined declarations

SugarCube `<<widget>>`, `Macro.add`, Harlowe custom macros, and equivalent
source-defined facilities are intentionally not implemented. A future declaration
layer may let all three dialects introduce named extensions, but those declarations
must resolve to the same `invoke`/`RuntimeExtension` contract instead of creating a
second privileged runtime. Scripts, DOM queries, and runtime code injection remain
outside the portable profiles.

The story ABI remains version 1. It was never a production ABI, so the old registry
option and type names are removed rather than retained as aliases.
