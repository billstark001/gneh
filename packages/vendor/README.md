# @gneh/vendor

Source/IR vendor loader and optional dynamic wikification.

`startVendor` uses the minimal `mountStory` adapter. It does not provide application
chrome, themes, or the editable starter template. Most Vite applications should
prefer compiled ESM; this package is for explicit source/IR loading workflows.

Part of gneh 0.1.0. See the workspace README and docs for the supported language profile and verification limitations.

This is a source-workspace package; build with `pnpm build` at the workspace root. Its public entry exports ESM plus TypeScript declarations.

New gneh code is MIT licensed.
