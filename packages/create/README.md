# @gneh/create

Create an editable Vite-based gneh project:

```sh
npm create @gneh@latest my-story
# or: pnpm dlx @gneh/create my-story
npm create @gneh@latest my-preact-story -- --template preact
npm create @gneh@latest my-vue-story -- --template vue
```

The generated application owns its layout, controls and CSS. gneh supplies the story runtime, the optional DOM renderer and the Vite compiler integration. All three variants derive from one shared vanilla template; Preact and Vue replace only the mounting entry and add their framework dependency.
