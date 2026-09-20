import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { gneh } from '@gneh/vite';
import { inkdown } from '@gneh/inkdown';

export default defineConfig({ plugins: [react(), gneh({ dialects: [inkdown()] })] });
