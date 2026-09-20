<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { DOMRenderer, type DOMMount } from '@gneh/renderer-dom';
import primary, { fragments } from './story/main.inkdown';
import { createStory } from './story';

const story = createStory(Object.values(fragments), { entry: primary.id, state: { visits: 0 } }).start();
const host = ref<HTMLElement>();
const current = ref(story.current);
const revision = ref(0);
const renderer = new DOMRenderer();
const mount = shallowRef<DOMMount>();
let unsubscribe: (() => void) | undefined;
onMounted(() => {
  unsubscribe = story.subscribe((view) => {
    if (!host.value) return;
    if (mount.value) renderer.update(mount.value, view);
    else mount.value = renderer.mount(host.value, view);
    current.value = story.current;
    revision.value++;
  });
});
onBeforeUnmount(() => {
  unsubscribe?.();
  if (mount.value) renderer.dispose(mount.value);
  story.dispose();
});
</script>

<template>
  <div class="gneh-app" data-environment="story-flow" :data-revision="revision">
    <header class="toolbar">
      <strong>GNĒH <small>Vue starter</small></strong>
      <button :disabled="!story.canUndo" @click="story.undo()">Undo</button
      ><button :disabled="!story.canRedo" @click="story.redo()">Redo</button>
    </header>
    <div class="layout">
      <aside>
        <p>PASSAGES</p>
        <nav>
          <button
            v-for="fragment in [...story.fragments.values()].filter((item) => item.metadata.nav !== false)"
            :key="fragment.id"
            :aria-current="fragment.id === current ? 'page' : undefined"
            @click="story.navigate(fragment.id)"
          >
            {{ String(fragment.metadata.title ?? fragment.id) }}
          </button>
        </nav>
      </aside>
      <main>
        <div class="route">{{ current }}</div>
        <article ref="host" />
      </main>
    </div>
  </div>
</template>
