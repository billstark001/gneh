# @gneh/vite

Vite transforms for explicitly imported narrative modules.

No dialect is enabled implicitly. Register each authoring frontend in `vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { gneh } from '@gneh/vite';
import { inkdown } from '@gneh/inkdown';

export default defineConfig({ plugins: [gneh({ dialects: [inkdown()] })] });
```

Application code owns the project graph and imports every story module it ships:

```ts
import start, { fragments as main } from './story/main.inkdown';
import { fragments as appendix } from './story/appendix.inkdown';

const fragments = { ...main, ...appendix };
```

Native extensions are claimed only for registered dialects; Sugarcast owns both `.sugarcast` and `.sugar`. Ambiguous `.md`, `.twee`, and `.tw` imports require `?gneh` and use source metadata or the registered Inkdown fallback. A query value can select a registered dialect explicitly, for example `story.twee?gneh=karlowe`. Vite asset queries such as `?raw` and `?url` remain Vite-owned.

The plugin does not scan story directories, expose a virtual project alias, mount UI, inject CSS, import project helpers, or write generated files beside sources. Each frontend owns its conservative module declaration, such as `@gneh/inkdown/client`; the gneh language server supplies authoring diagnostics and projections.

See [the explicit-import decision](../../docs/decisions/0001-explicit-story-imports.md).
