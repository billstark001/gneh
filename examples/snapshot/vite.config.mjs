import { defineConfig } from 'vite';
import { gneh } from '@gneh/vite';
import { inkdown } from '@gneh/inkdown';

export default defineConfig({
  base: './',
  plugins: [gneh({ dialects: [inkdown()], live: false })],
});
