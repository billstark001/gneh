#!/usr/bin/env node
export { main } from './main.js';

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { main } from './main.js';

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
