<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { DOMRenderer, type DOMMount } from '@gneh/renderer-dom';
import type { Story } from '@gneh/runtime';

const { story } = defineProps<{ story: Story }>();
const host = ref<HTMLElement>();
const current = ref(story.current);
const revision = ref(0);
const renderer = new DOMRenderer();
const mount = shallowRef<DOMMount>();
let unsubscribe: (() => void) | undefined;

function save() {
  localStorage.setItem('gneh:save', story.save());
}

function load() {
  const saved = localStorage.getItem('gneh:save');
  if (saved) story.load(saved);
}

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
});
</script>

<template>
  <div class="gneh-app" data-environment="story-flow" :data-revision="revision">
    <header class="toolbar">
      <strong>GNĒH <small>Vue starter</small></strong>
      <button :disabled="!story.canUndo" @click="story.undo()">Undo</button
      ><button :disabled="!story.canRedo" @click="story.redo()">Redo</button>
      <button @click="save">Save</button>
      <button @click="load">Load</button>
    </header>
    <div class="layout">
      <aside>
        <p>PASSAGES</p>
        <nav>
          <button
            v-for="fragment in [...story.fragments.values()].filter(
              (item) =>
                item.metadata.nav !== false && !(Array.isArray(item.metadata.params) && item.metadata.params.length),
            )"
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
