# @gneh/vite

Vite integration for typed narrative ESM modules.

Native `.inkdown`, `.karlowe`, and `.sugarcast` files compile automatically. Import ambiguous `.md`, `.twee`, or `.tw` sources with `?gneh`; the plugin deliberately leaves ordinary Markdown and framework files to other plugins.

```ts
import Start, { fragments, metadata } from './story/main.inkdown';
const Card = fragments.Card;
```

Direct transforms emit adjacent arbitrary-extension declarations such as `main.d.inkdown.ts`, so TypeScript can infer concrete passage props. Enable `allowArbitraryExtensions` and add `@gneh/vite/client` to `compilerOptions.types`.

Compose several story modules explicitly or with Vite's standard `import.meta.glob`. The plugin does not mount UI, inject CSS, replace Vite's server/build commands, add virtual import aliases, or force full reloads.

See the workspace README and `docs/CLI.md` for examples.
