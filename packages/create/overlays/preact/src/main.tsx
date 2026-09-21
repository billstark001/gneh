import { render } from 'preact';
import { App } from './App';
import passages from './story/main.inkdown';
import { createStory } from './story';
import './style.css';

const root = document.querySelector<HTMLElement>('#app');
if (!root) throw new Error('Missing #app host');
document.documentElement.dataset.gnehEnvironment = 'story-flow';
const story = createStory(passages, { entry: 'Start', state: { visits: 0 } }).start();
render(<App story={story} />, root);

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    render(null, root);
    story.dispose();
  });
