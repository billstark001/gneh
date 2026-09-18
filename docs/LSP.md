# LSP and JavaScript/TypeScript types

The three dialects share one language server implementation, while retaining separate parsers.

```sh
pnpm install --no-frozen-lockfile
pnpm build
pnpm lsp
# or
node packages/lsp/dist/index.js --stdio
```

Standard output is reserved for JSON-RPC. Errors go to standard error. The preferred transport uses `vscode-languageserver`; when it is unavailable, or when `GNEH_LSP_TRANSPORT=builtin` is set, the bundled Content-Length transport calls the same server and language service.

## Implemented features

- open/change/save/close and incremental text updates;
- diagnostics, completion, hover, definitions, references, and conservative rename;
- document and workspace symbols, watched files, and shutdown;
- parser/compiler diagnostics for unsupported constructs, references, props, and capabilities;
- virtual TypeScript projection for expression/action diagnostics and state member completion;
- prop types from `params`/`paramTypes` and loop-local projection;
- AST-span-based passage operations that do not replace matching prose;
- `gneh/virtualDocument` for inspecting generated TypeScript.

The server discovers sources from `gneh.config.json` and ignores generated and dependency directories. It rebuilds project analysis after relevant changes; version 0.1 is not a million-line incremental indexer.

## Neovim example

```lua
vim.filetype.add({ extension = {
  inkdown = 'inkdown', karlowe = 'karlowe', sugarcast = 'sugarcast',
}})

vim.api.nvim_create_autocmd('FileType', {
  pattern = {'inkdown', 'karlowe', 'sugarcast'},
  callback = function()
    vim.lsp.start({
      name = 'gneh',
      cmd = {'node', '/absolute/path/to/gneh/packages/lsp/dist/index.js', '--stdio'},
      root_dir = vim.fs.root(0, {'gneh.config.json', 'pnpm-workspace.yaml', '.git'}),
    })
  end,
})
```

This uses the editor's generic LSP client. gneh 0.1 does not ship a dedicated VS Code or Neovim extension.

## Why two TypeScript versions exist

TypeScript 7 builds and checks the workspace. The language service imports the classic JavaScript compiler API through the `typescript-language-service` npm alias, currently pinned to TypeScript 6. Do not replace that import with `typescript` and assume the native TypeScript 7 CLI package exports the same API.

## Precision limits

External `@module` bindings are conservatively typed in template projection. Full type inference for ordinary ESM remains the responsibility of the application build. Diagnostic mapping is expression/action-block level and may not preserve an exact sub-token column after a dialect alias is lowered. Rename refuses ambiguous IDs, header-name/metadata-ID mismatches, and dynamic references.

`packages/language-service/test/language-service.test.ts` covers the TypeScript projection and cross-file operations. `packages/lsp/test/lsp.test.ts` launches real server subprocesses and exchanges Content-Length protocol messages over both supported transports.
