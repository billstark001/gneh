# @gneh/create

Create an editable Vite-based gneh project:

```sh
npm create @gneh@latest my-story
# or: pnpm dlx @gneh/create my-story
npm create @gneh@latest my-react-story -- --template react
npm create @gneh@latest my-preact-story -- --template preact
npm create @gneh@latest my-vue-story -- --template vue
```

The generated application owns its layout, controls and CSS. Vanilla, React, Preact, and Vue templates contain native lifecycle and component code; React and Preact are separate targets and the Preact project does not install or use `preact/compat`. Every template explicitly registers Inkdown and imports its story modules from application code.
