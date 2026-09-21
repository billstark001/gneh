import { defineConfig } from 'vite';
import { gneh } from '@gneh/vite';
import { inkdown } from '@gneh/inkdown';
import { karlowe } from '@gneh/karlowe';
import { sugarcast } from '@gneh/sugarcast';

export default defineConfig({
  base: './',
  plugins: [gneh({ dialects: [inkdown(), karlowe(), sugarcast()] })],
});
