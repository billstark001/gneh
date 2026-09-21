import { test } from 'vitest';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';

let available = true;

try {
  await import('../../language-service/dist/index.js');
} catch {
  available = false;
}

for (const transport of ['builtin', 'ecosystem'])
  test(
    `LSP ${transport}: initialize, diagnostics, completion, definition, change and shutdown`,
    {
      skip: available ? false : 'Install workspace dependencies for the LSP test.',
      timeout: 20000,
    },
    async () => {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gneh-lsp-'));
      const child = spawn(process.execPath, [fileURLToPath(new URL('../dist/index.js', import.meta.url)), '--stdio'], {
        env: {
          ...process.env,
          ...(transport === 'builtin' ? { GNEH_LSP_TRANSPORT: 'builtin' } : {}),
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let buffer = Buffer.alloc(0),
        serial = 0,
        stderr = '';
      const requests = new Map(),
        messages = [];
      child.stderr.on('data', (chunk) => (stderr += chunk));
      child.stdout.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        while (true) {
          const index = buffer.indexOf('\r\n\r\n');
          if (index < 0) return;
          const length = Number(/Content-Length:\s*(\d+)/i.exec(buffer.subarray(0, index).toString())[1]);
          if (buffer.length < index + 4 + length) return;
          const message = JSON.parse(buffer.subarray(index + 4, index + 4 + length));
          buffer = buffer.subarray(index + 4 + length);
          messages.push(message);
          if (message.id !== undefined) {
            const pending = requests.get(message.id);
            requests.delete(message.id);
            if (message.error) pending?.reject(Error(message.error.message));
            else pending?.resolve(message.result);
          }
        }
      });
      const send = (message) => {
        const data = Buffer.from(JSON.stringify({ jsonrpc: '2.0', ...message }));
        child.stdin.write(`Content-Length: ${data.length}\r\n\r\n`);
        child.stdin.write(data);
      };
      const request = (method, params) =>
        new Promise((resolve, reject) => {
          const id = ++serial;
          requests.set(id, { resolve, reject });
          send({ id, method, params });
        });
      try {
        await fs.writeFile(
          path.join(directory, 'gneh.config.json'),
          JSON.stringify({ sources: ['story.inkdown'], state: { hp: 3 } }),
        );
        const initialized = await request('initialize', {
          rootUri: pathToFileURL(directory).href,
          capabilities: {},
        });
        assert.equal(initialized.serverInfo.name, 'gneh');
        assert.equal(initialized.capabilities.textDocumentSync.change, 2);
        send({ method: 'initialized', params: {} });
        const file = path.join(directory, 'story.inkdown'),
          uri = pathToFileURL(file).href,
          text = `:: Start
HP: $hpx
[[Go->End]]
:: End
Done`;
        send({
          method: 'textDocument/didOpen',
          params: { textDocument: { uri, languageId: 'inkdown', version: 1, text } },
        });
        const completion = await request('textDocument/completion', {
          textDocument: { uri },
          position: { line: 1, character: 6 },
        });
        assert.ok(completion.items.some((x) => x.label === 'hp'));
        assert.ok(
          messages.some(
            (m) =>
              m.method === 'textDocument/publishDiagnostics' &&
              m.params.diagnostics.some((d) => String(d.code).startsWith('TS')),
          ),
        );
        const definition = await request('textDocument/definition', {
          textDocument: { uri },
          position: { line: 2, character: 8 },
        });
        assert.equal(definition.uri, uri);
        assert.equal(definition.range.start.line, 3);
        send({
          method: 'textDocument/didChange',
          params: {
            textDocument: { uri, version: 2 },
            contentChanges: [
              {
                range: { start: { line: 1, character: 7 }, end: { line: 1, character: 8 } },
                text: '',
              },
            ],
          },
        });
        const hover = await request('textDocument/hover', {
          textDocument: { uri },
          position: { line: 1, character: 5 },
        });
        assert.match(hover.contents.value, /number/);
        const latest = messages.filter((m) => m.method === 'textDocument/publishDiagnostics').at(-1);
        assert.equal(latest.params.diagnostics.filter((d) => String(d.code).startsWith('TS')).length, 0);
        await request('shutdown', {});
        send({ method: 'exit', params: {} });
        child.stdin.end();
        await new Promise((resolve, reject) => {
          child.once('exit', (code) => (code === 0 ? resolve() : reject(Error(`exit ${code}: ${stderr}`))));
        });
        assert.equal(stderr, '');
      } finally {
        child.kill();
        await fs.rm(directory, { recursive: true, force: true });
      }
    },
  );
