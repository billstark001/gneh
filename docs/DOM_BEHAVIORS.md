# DOM behavior and host integration

gneh's portable story profiles do not give story source an ambient `document`, but this does not prevent an application from implementing DOM-heavy effects. It means that DOM identity and browser authority belong to the application that owns the renderer, while story state and story flow remain inside `Story`.

This guide shows how to implement Harlowe/SugarCube-style DOM effects at that boundary. It does not add DOM operations to Story IR and it does not attempt to reproduce either engine's private macro runtime.

## Runtime model

```text
story action
    -> one Story transaction
    -> View[] recomputation
    -> keyed DOMRenderer patch
    -> application-owned DOM behavior
```

Keep data in the narrowest owner that can express its lifetime:

| Data | Owner | Examples |
| --- | --- | --- |
| Persistent narrative state | `Story.state` | inventory, relationship values, whether a door is open |
| Fragment-instance UI state | Fragment local/region state | a revealed hook, temporary replacement content |
| Browser-only state | application or extension renderer | focus, selection ranges, observers, a canvas instance |

The keyed renderer owns the nodes it creates. Application code may focus, measure, observe, animate, or decorate those nodes. It should not remove, reorder, or replace renderer-owned children behind the renderer, because the next keyed patch still assumes that tree is intact.

## Start with no plugin

Many effects that look like DOM programming do not need a DOM plugin at all.

### Styling and named targets

Inkdown presentation tokens and IDs become `data-tokens` and `data-ref` in the DOM renderer:

```inkdown
[The reactor is overheating.]{#reactor .warning .pulsing}
```

The application can style that semantic output directly:

```css
[data-tokens~='warning'] {
  color: var(--danger);
}
[data-tokens~='pulsing'] {
  animation: pulse 800ms ease-in-out infinite alternate;
}
```

This is preferable to walking text nodes and adding wrapper elements. Karlowe named hooks likewise provide semantic targets for `replace`, `append`, and `prepend`; they are runtime regions, not global CSS selectors. Ordinary show/hide and replacement behavior is usually clearer as state, a conditional, or a region update than as imperative DOM mutation.

### Browser capabilities through `host()`

`StoryOptions.host` is the application-owned capability boundary for focus, scrolling, clipboard, downloads, dialogs, external navigation, persistence, and similar browser operations. Inkdown actions can call the injected `host` binding:

```inkdown
@action scrollToReactor() {
  @do host("scroll-ref", "reactor");
}

@action copyCode() {
  @do host("clipboard-write", $accessCode);
}

[[Show the warning => scrollToReactor]]
[[Copy access code => copyCode]]

[The reactor is overheating.]{#reactor .warning}
```

The matching host implementation stays scoped to the application's story root:

```ts
import { Story, type StoryOptions } from '@gneh/runtime';

function elementByRef(root: HTMLElement, ref: string): HTMLElement | undefined {
  return [...root.querySelectorAll<HTMLElement>('[data-ref]')].find((element) => element.dataset.ref === ref);
}

export function browserHost(root: HTMLElement): StoryOptions['host'] {
  return (operation, args, story) => {
    switch (operation) {
      case 'focus-ref':
        queueMicrotask(() => elementByRef(root, String(args[0]))?.focus({ preventScroll: true }));
        return;
      case 'scroll-ref':
        queueMicrotask(() => elementByRef(root, String(args[0]))?.scrollIntoView({ behavior: 'smooth' }));
        return;
      case 'clipboard-write':
        void navigator.clipboard.writeText(String(args[0] ?? ''));
        return;
      case 'open-external':
        return window.open(String(args[0] ?? ''), '_blank', 'noopener,noreferrer');
      case 'restart':
        window.location.reload();
        return;
      case 'undo':
        return story.undo();
      default:
        throw new Error(`Host operation is unavailable: ${operation}`);
    }
  };
}
```

The root-scoped lookup matters when several stories exist on one page. Comparing `dataset.ref` also avoids interpolating story data into a CSS selector.

Karlowe already lowers `(goto-url:)`, `(reload:)`, `(save-game:)`, `(load-game:)`, `(link-undo:)`, and `?sidebar` changes to named host operations. The generated application template contains a small `browserHost` implementation for the common operations. Sugarcast and Inkdown can call an explicitly provided `host()` capability from an effect expression when an equivalent built-in form is absent. For example, the Sugarcast side of the clipboard bridge is:

```sugarcast
<<button "Copy access code">>
  <<run host("clipboard-write", $accessCode)>>
<</button>>
```

Host calls are synchronous from the Story transaction's point of view. A focus or scroll target created by the same action does not exist until the ensuing renderer update, which is why the example queues those lookups in a microtask. Operations that require the original user-activation event, such as opening a popup, should stay synchronous. A host may also start a longer asynchronous browser task, but its eventual completion must begin a new application action (for example, `story.mutate(...)`) instead of mutating the transaction after it has returned.

### DOM events back into story state

Event delegation on the story root implements Harlowe-like click or hover targets without one listener per rerender. The mapping is application policy rather than source text executed as JavaScript:

```ts
function installStoryEvents(root: HTMLElement, story: Story): () => void {
  const click = (event: MouseEvent) => {
    const element = (event.target as Element | null)?.closest<HTMLElement>('[data-ref]');
    if (!element || !root.contains(element)) return;

    if (element.dataset.ref === 'reactor') {
      story.mutate((state) => {
        state.reactorInspected = true;
      });
    }
  };

  root.addEventListener('click', click);
  return () => root.removeEventListener('click', click);
}
```

Story markup supplies the semantic marker (`#reactor`); application code decides what authority that marker has. For a reusable project, put the mapping in a table rather than scattering selectors through the code. Keyboard activation and accessibility semantics must be implemented too if a non-interactive span is made clickable; an ordinary Inkdown action button is preferable when it can express the UI.

## Effects that need a post-render phase

Selection highlights, geometry-dependent popovers, and animation libraries often need to run after a DOM patch. `mountStory` intentionally installs no global behavior layer, so an application that needs one can compose `Story` and `DOMRenderer` directly:

```ts
import type { View } from '@gneh/core';
import { Story, type PassageSet } from '@gneh/runtime';
import { DOMRenderer } from '@gneh/renderer-dom';

interface DOMBehavior {
  afterCommit(root: HTMLElement, view: readonly View[], story: Story): void;
  dispose?(): void;
}

export function mountWithBehaviors(root: HTMLElement, passages: PassageSet, behaviors: readonly DOMBehavior[]) {
  const renderer = new DOMRenderer();
  const story = new Story(passages, { host: browserHost(root) });
  const mount = renderer.mount(root, story.view);

  const render = (view: View[]) => {
    renderer.update(mount, view);
    for (const behavior of behaviors) behavior.afterCommit(root, view, story);
  };
  const unsubscribe = story.subscribe(render);

  return {
    story,
    dispose() {
      unsubscribe();
      for (const behavior of behaviors) behavior.dispose?.();
      renderer.dispose(mount);
      story.dispose();
    },
  };
}
```

`subscribe()` immediately supplies the current view, so this small adapter performs one harmless update after the initial mount. A larger adapter may avoid that duplicate patch, but it must still run each behavior after every update and clean it up before disposing the renderer.

A behavior may use event delegation, `ResizeObserver`, `IntersectionObserver`, `Range`, or the CSS Custom Highlight API. Prefer a `Range`/highlight for visual text selection. Splitting and wrapping text nodes after every patch changes renderer-owned structure and is difficult to reconcile safely. If actual wrappers are required, implement them as a renderer-owned view/extension instead.

Timers follow the same ownership rule. The timer callback should enter the runtime through `story.mutate`, `story.navigate`, or a Fragment action; the disposer must clear the timer. Do not store narrative truth in a DOM class or infer it from whether a timer-created node still exists.

## Portals for sidebar, modal, HUD, and toast output

Karlowe changes to `?sidebar` produce the host call `host('portal', [name, mode, views])`. The host can mount those views into an application-owned target and return a cleanup function. The Fragment calls that cleanup when it is disposed:

```ts
import { DOMRenderer, type DOMMount } from '@gneh/renderer-dom';
import type { View } from '@gneh/core';

const renderer = new DOMRenderer();
const portalTargets = new Map([['sidebar', document.querySelector<HTMLElement>('#sidebar')!]]);
const portalMounts = new Map<string, DOMMount>();

function portal(name: string, mode: string, views: View[]): () => void {
  const target = portalTargets.get(name);
  if (!target) throw new Error(`Missing portal target: ${name}`);

  // replace/append/prepend policy belongs here. This minimal example owns one mount per target.
  const previous = portalMounts.get(name);
  if (previous) renderer.dispose(previous);
  const mount = renderer.mount(target, views);
  portalMounts.set(name, mount);

  return () => {
    if (portalMounts.get(name) !== mount) return;
    renderer.dispose(mount);
    portalMounts.delete(name);
  };
}
```

Pass this function from the application's `host` switch. A production implementation can keep ordered portal entries to give `append` and `prepend` their exact meanings. The important part is that each entry has an owner and a deterministic disposer; it is not anonymous HTML left under `document.body`.

## When a custom renderer is justified

Use `DOMOptions.extensions` when one semantic story node must own a DOM subtree or a third-party widget: a map, canvas game, code editor, media player, date picker, or sanitized rich-content component. This is lighter than a general `DOMPlugin`: it handles only `extension:<name>` views and has explicit mount/update/dispose hooks.

Inkdown is already able to emit such a node, including reactive attributes:

```inkdown
::: map {lat={{$place.lat}} lng={{$place.lng}} zoom=12 #worldMap}
The map could not be displayed.
:::
```

Bridge it to the DOM and back to the story when the application is assembled:

```ts
import type { View } from '@gneh/core';
import { Story } from '@gneh/runtime';
import { DOMRenderer, type ExtensionRenderer } from '@gneh/renderer-dom';

function mapRenderer(story: Story): ExtensionRenderer {
  return (initial, document) => {
    const element = document.createElement('div');
    element.setAttribute('role', 'application');
    const map = createMapLibraryInstance(element);

    const update = (view: View) => {
      const { lat, lng, zoom } = view.attrs ?? {};
      map.setView(Number(lat), Number(lng), Number(zoom));
    };
    const unlisten = map.onPick((lat: number, lng: number) => {
      story.mutate((state) => {
        state.place = { lat, lng };
      });
    });

    update(initial);
    return {
      element,
      update,
      dispose() {
        unlisten();
        map.destroy();
      },
    };
  };
}

const story = new Story(passages);
const renderer = new DOMRenderer({
  extensions: { map: mapRenderer(story) },
});
```

`createMapLibraryInstance` is application code, not a gneh global. The extension renderer owns the element it returns. If story children should appear inside a particular node, return that node as `childrenHost`; otherwise the returned element is the child host. `update` must tolerate every reactive attribute change, and `dispose` must remove listeners, observers, timers, and third-party instances.

Use a full `DOMPlugin` only when a new rule must recognize or change the rendering of a class of View nodes. Built-in rules and extension renderers already cover most applications. Plugins are trusted application code and should never evaluate arbitrary strings from story source.

## Unknown compatibility macros

An unknown Karlowe or Sugarcast macro can be connected in two explicit steps when it represents trusted project functionality:

1. register a CST lowering or allow the frontend's generic `invoke` node, and declare its ID to the compiler;
2. install a `RuntimeExtension` that returns semantic views or performs an allowed effect.

If that result is DOM-specific, have the runtime extension return an `extension:<name>` view and install the corresponding `DOMOptions.extensions` renderer. The full bridge is therefore:

```text
story macro
  -> declared invoke ID
  -> RuntimeExtension (transaction and story semantics)
  -> extension:name View
  -> ExtensionRenderer (DOM ownership)
```

See [Syntax lowerings and runtime extensions](EXTENSIONS.md) for registration code. This longer route is for source syntax that genuinely needs a compatibility macro. New Inkdown normally emits an extension container directly and skips both the custom lowering and runtime extension.

## Security and lifecycle checklist

- Scope selectors and delegated events to the mounted story root, not `document`.
- Prefer `textContent`, DOM construction, and typed attributes to `innerHTML`. If rich HTML is a product requirement, sanitize it in trusted application code before an extension renderer owns it.
- Keep persistent truth in story state; DOM classes and widget instances are projections.
- Enter the Story through `mutate`, `navigate`, actions, or host operations. Never write private runtime fields from a callback.
- Dispose every listener, observer, timer, portal mount, and third-party instance.
- Do not remove or reorder children owned by `DOMRenderer`.
- Give clickable targets keyboard and assistive-technology semantics, or use a normal action button.
- Make unavailable host capabilities fail explicitly so the same story cannot silently behave differently in another application.

The result preserves gneh's portable runtime model without forbidding rich browser behavior: Story owns meaning and transactions; the application owns browser authority; the renderer is the lifecycle-aware bridge between them.
