import { defineConfig } from 'vite';
import { gneh } from '@gneh/vite';
import { inkdown } from '@gneh/inkdown';

export default defineConfig({
  plugins: [gneh({ dialects: [inkdown()] })],
});
