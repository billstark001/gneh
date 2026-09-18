# Getting started

## Create an application

```sh
npm create @gneh@latest my-story
# Add `-- --template preact` or `-- --template vue` for a framework mount.
cd my-story
npm install
npm run dev
```

Equivalent package-manager entry points include `pnpm dlx @gneh/create my-story` and `yarn dlx @gneh/create my-story`. The generated project is a normal Vite application:

```text
my-story/
  index.html
  package.json
  vite.config.ts
  src/
    main.ts
    ui.ts
    style.css
    story/main.inkdown
```

`ui.ts` and `style.css` are deliberately application code. Vanilla, Preact, and Vue projects are derived from this same template rather than maintained as three copies. The initial template can switch between Wiki, story-flow and visual-novel presentations, but these are not runtime policies. Delete or replace them when integrating React, Vue, Svelte, Three.js, a design system, or an existing site.

## Vite integration

The starter config enables direct story-module compilation:

```ts
import { defineConfig } from 'vite';
import { gneh } from '@gneh/vite';

export default defineConfig({
  plugins: [gneh()],
});
```

Story files are ordinary typed ESM imports. The default export is the first Fragment, and `fragments` contains every passage in the file:

```ts
import Start, { fragments, metadata } from './story/main.inkdown';
const Card = fragments.Card;
```

Vite writes an adjacent `main.d.inkdown.ts` (or corresponding Karlowe/Sugarcast name) with concrete passage and prop types. Keep `allowArbitraryExtensions` enabled and include `@gneh/vite/client` in `compilerOptions.types`. `import-twine` writes the same declaration immediately for imported stories. Compose multiple source modules explicitly or with Vite's standard `import.meta.glob`.

`.inkdown`, `.karlowe`, and `.sugarcast` are compiled automatically. Generic `.md`, `.twee`, and `.tw` files require `?gneh`; without it they remain available to other Vite plugins or `?raw` imports.

## Mounting and frameworks

For a small plain-DOM application, `mountStory` connects one runtime instance to one host element:

```ts
import { mountStory } from '@gneh/renderer-dom';
import Start, { fragments } from './story/main.inkdown';

const mounted = mountStory(document.querySelector('#story')!, Object.values(fragments), {
  entry: Start.id,
  state: { visits: 0 },
});
```

It only replaces children of the supplied host. It installs no stylesheet, router, document-level keyboard handler or global registry. Framework integrations may skip it entirely: construct `Story` from `@gneh/runtime`, subscribe to semantic views, and render them with framework components.

## Domain CLI

The CLI complements Vite rather than replacing it:

```sh
gneh check src/story
gneh metadata src/story -o story-metadata.json
gneh graph src/story
gneh compile src/story -o .gneh/esm
```

Use `npm run build` and `npm run preview` for the web application.

## Workspace examples and verification

`examples/vite-app` demonstrates a story mounted beside an unrelated DOM root, a regular Markdown `?raw` import, and a handwritten JavaScript Fragment. The complete editable starter lives in `packages/create/template`; `pnpm demos` builds both with Vite into ignored `demo/` output.

```sh
pnpm check
pnpm test:browser
```

The browser suite uses a system Chrome/Chromium through `puppeteer-core`. Set `GNEH_CHROMIUM` when automatic discovery is insufficient. Local screenshots and reports stay in the ignored `verification/` directory.
