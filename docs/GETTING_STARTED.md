# Getting started

## Create an application

```sh
npm create @gneh@latest my-story
# Add `-- --template react`, `preact`, or `vue` for a framework-native application.
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

`ui.ts` and `style.css` are deliberately application code in the vanilla starter. React, Preact, and Vue instead receive native components and lifecycle code; React and Preact are distinct targets and Preact does not use `preact/compat`. Presentation choices are not runtime policies, so the generated UI can be replaced freely.

React and Preact use the workspace's TypeScript 7 CLI. The Vue starter currently pins TypeScript 6 and runs `vue-tsc --noEmit`, because the current Vue checker still consumes the classic compiler API that the TypeScript 7 native CLI package does not export.

## Vite integration

The starter config enables direct story-module compilation:

```ts
import { defineConfig } from 'vite';
import { gneh } from '@gneh/vite';
import { inkdown } from '@gneh/inkdown';

export default defineConfig({
  plugins: [gneh({ dialects: [inkdown()] })],
});
```

Story files are ordinary typed ESM imports. Each native source module default-exports an immutable `PassageSet` keyed by canonical passage ID:

```ts
import passages from './story/main.inkdown';
const Start = passages.Start;
const Card = passages.Card;
```

Named exports come only from the file YAML `exports` list or automatic unbounded primary callables. There is no first-passage default or display-name alias.

Vite never writes generated files beside story sources. Include the selected frontend declaration, such as `@gneh/inkdown/client`, in `compilerOptions.types` for conservative module types; use the gneh language server for concrete authoring diagnostics and projections. Compose multiple source modules with explicit imports in application code.

Only explicitly registered native dialect extensions are compiled: `.inkdown`, `.karlowe`, and `.sugarcast`. Generic `.md`, `.twee`, and `.tw` files remain available to other tooling; `?raw`, `?url`, and worker queries keep their ordinary Vite meaning.

## Mounting and frameworks

For a small plain-DOM application, `mountStory` connects one runtime instance to one host element:

```ts
import { mountStory } from '@gneh/renderer-dom';
import passages from './story/main.inkdown';

const mounted = mountStory(document.querySelector('#story')!, passages, {
  entry: 'Start',
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

`examples/playground` is a three-dialect application, `examples/snapshot` demonstrates a non-live document, and `examples/vite-app` mounts a story beside an unrelated DOM root while importing regular Markdown and handwritten JavaScript Fragments. Each example supports `start`, `check`, `build`, and `preview`; its production build is a deployable `dist/index.html`. The complete editable starter lives in `packages/create/template`; `pnpm build:examples` runs every example's own build script and keeps output beside its project.

```sh
pnpm check
pnpm test:browser
```

The browser suite uses a system Chrome/Chromium through `puppeteer-core`. Set `GNEH_CHROMIUM` when automatic discovery is insufficient. Local screenshots and reports stay in the ignored `verification/` directory.
