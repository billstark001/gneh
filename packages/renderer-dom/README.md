# @gneh/renderer-dom

Keyed DOM backend for gneh semantic views. `mountStory` is an optional minimal adapter that connects one Story to one host. It installs no styles, document-level listeners, router, global registry, or application chrome.

React, Vue and other renderers can subscribe to `Story` directly and need not use this package.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

New gneh code is MIT licensed.
