import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { gneh } from '@gneh/vite';
import { inkdown } from '@gneh/inkdown';

export default defineConfig({ plugins: [preact(), gneh({ dialects: [inkdown()] })] });
