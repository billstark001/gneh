# @gneh/renderer-dom

Keyed DOM backend for gneh semantic views. DOM reconciliation is separate from DOM presentation policy, so applications can compose or override rendering rules without forking the reconciler.

`mountStory` is an optional minimal adapter that connects one Story to one host. It installs no styles, document-level listeners, router, global registry, or application chrome. React, Vue and other renderers can subscribe to `Story` directly and need not use it.

## Modules

- `renderer.ts`: keyed reconciliation, focus preservation, lifecycle, and child reconciliation.
- `registry.ts`: rule resolution. Later plugins have higher priority.
- `rules.ts`: low-level rule and feature composition helpers.
- `features/*`: reusable DOM behavior such as metadata, activation, URLs, and images.
- `plugins/core.ts`: semantic content mapped to default HTML elements.
- `plugins/interaction.ts`: region, choice, and button behavior.
- `plugins/controls.ts`: exact `control:select` and `control:checkbox` implementations.
- `plugins/presentation.ts`: built-in presentation extensions and unsupported handling.
- `plugins/extensions.ts`: compatibility adapter for the previous extension renderer map.

## Default use

```ts
import { createDOMRenderer } from '@gneh/renderer-dom';

const renderer = createDOMRenderer();
```

The default renderer is assembled from `coreDOM()`, `interactionDOM()`, `controlsDOM()`, and `presentationDOM()`.

## Override a rule

Later plugins win, so application-specific presentation can replace a default without changing reconciliation.

```ts
import { createDOMRenderer, elementRule, metadataFeature, type DOMPlugin } from '@gneh/renderer-dom';

const applicationDOM: DOMPlugin = {
  name: 'application',
  rules: [
    elementRule({
      id: 'application:choice',
      match: (view) => view.kind === 'choice',
      tag: 'button',
      features: [metadataFeature()],
    }),
  ],
};

const renderer = createDOMRenderer({ plugins: [applicationDOM] });
```

## Build a minimal renderer

```ts
import { DOMRenderer, coreDOM } from '@gneh/renderer-dom';

const renderer = new DOMRenderer({
  includeDefaults: false,
  plugins: [coreDOM()],
});
```

The old `extensions` option remains supported and is translated into a plugin internally. New code can use `extensionRenderersPlugin()` explicitly or define ordinary `DOMRule` plugins.

DOM shape is part of reconciliation identity, so changes to heading level and list ordering recreate the correct HTML element. Unknown `control:*` kinds raise `DOM_UNSUPPORTED_VIEW`; void elements do not accept reconciled children. Event listeners are attached once and disposed explicitly.

Part of gneh 0.1.0. This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations. New gneh code is MIT licensed.
