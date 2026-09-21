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
import main from './story/main.inkdown';
import appendix from './story/appendix.inkdown';
import { definePassages } from '@gneh/runtime';

const passages = definePassages(main, appendix);
```

Native extensions are claimed only for registered dialects: `.inkdown`, `.karlowe`, and `.sugarcast`. `.md`, `.twee`, `.tw`, and the removed `.sugar` alias are not claimed. Vite asset queries such as `?raw` and `?url` remain Vite-owned.

The plugin does not scan story directories, expose a virtual project alias, mount UI, inject CSS, import project helpers, or write generated files beside sources. Each frontend owns its conservative module declaration, such as `@gneh/inkdown/client`; the gneh language server supplies authoring diagnostics and projections.

See [the explicit-import decision](../../docs/decisions/0001-explicit-story-imports.md).
