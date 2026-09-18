#!/usr/bin/env node
/** Stable LSP entrypoint; protocol and transport are independently testable. */
export * from './server.js';

export * from './transport.js';

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from './transport.js';

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  startServer().catch((error) => {
    process.stderr.write(String(error) + '\n');
    process.exitCode = 1;
  });
