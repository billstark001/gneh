import { createApp as createVueApp, defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue';
import primary, { fragments } from './story/main.inkdown';
import { createApp as createStoryApp } from './ui';
import './style.css';

const requested = new URLSearchParams(location.search).get('environment');

const environment = ['wiki', 'story-flow', 'visual-novel'].includes(requested ?? '')
  ? (requested as 'wiki' | 'story-flow' | 'visual-novel')
  : undefined;

const StoryApplication = defineComponent(() => {
  const host = ref<HTMLElement>();
  let storyApp: ReturnType<typeof createStoryApp> | undefined;
  onMounted(() => {
    if (!host.value) return;
    storyApp = createStoryApp(host.value, Object.values(fragments), {
      entry: primary.id,
      state: { visits: 0 },
      environment,
    });
    (window as Window & { gnehApp?: typeof storyApp }).gnehApp = storyApp;
  });
  onBeforeUnmount(() => storyApp?.dispose());
  return () => h('div', { ref: host });
});

const root = document.querySelector<HTMLElement>('#app');

if (!root) throw new Error('Missing #app host');

createVueApp(StoryApplication).mount(root);
