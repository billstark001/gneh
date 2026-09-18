import { DOMRenderer, mountStory, safeURL } from '@gneh/renderer-dom';
import primary, { fragments } from './story.inkdown';
import Panel from './Panel.mjs';
import notes from './notes.md?raw';
import './style.css';

// This unrelated Markdown import is handled by Vite, not by gneh.
document.querySelector('#existing-app pre').textContent = notes;

window.app = mountStory(document.getElementById('story'), [...Object.values(fragments), Panel], {
  entry: primary.id,
  state: { count: 0 },
});

window.gnehTest = { DOMRenderer, safeURL };
