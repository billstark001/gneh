import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { gneh } from '@gneh/vite';
import { inkdown } from '@gneh/inkdown';

export default defineConfig({ plugins: [vue(), gneh({ dialects: [inkdown()] })] });
