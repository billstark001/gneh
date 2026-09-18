# Changelog

## Unreleased

Karlowe now uses a new lossless lexer and materialized source-order evaluation. The
portable profile adds semantic named-hook mutation, reveal/repeat interactions,
presentation changers, host portals, and bound controls without importing Harlowe's
DOM runtime. Sugarcast uses the same source-order effect model and supports its basic
checkbox form. All three frontends now dispatch built-ins and trusted build-time
extensions through caller-owned CST-to-IR lowering registries in `@gneh/syntax`;
Karlowe macro lookup is case-insensitive and internal-hyphen-optional. Expressions
now use a closed, origin-preserving AST with explicit state, temporary, lexical,
props, intrinsic, and host-binding references. Unknown Karlowe and Sugarcast macros
lower to generic `invoke` IR and require an explicitly declared `RuntimeExtension`.
Source-defined widgets and custom macros remain deferred. The superseded registry
API names were removed without aliases, and the pre-production serialized story ABI
remains version 1.

## 0.1.0

First runnable reference distribution of gneh.

Shared Twee/front-matter source layer; inkdown, karlowe and sugarcast portable frontends; semantic IR and typed Fragment ABI; interpreted data and generated ESM; state transactions, history, saves, regions; DOM renderer with wiki/story-flow/visual-novel environments; vendor bundles; Vite plugin; CLI; TypeScript-backed language service and LSP; mixed-language demos and executable tests.

The upstream parser extraction is pinned and licensed. No old Harlowe interpreter or Twine adapter is included. Production-toolchain and offline-verification distinctions are documented rather than hidden.
