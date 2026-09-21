import { createApp } from 'vue';
import App from './App.vue';
import passages from './story/main.inkdown';
import { createStory } from './story';
import './style.css';

document.documentElement.dataset.gnehEnvironment = 'story-flow';
const story = createStory(passages, { entry: 'Start', state: { visits: 0 } }).start();
const application = createApp(App, { story });
application.mount('#app');

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    application.unmount();
    story.dispose();
  });
