import { LanguageServer, type Wire } from './server.js';

/** Small zero-dependency transport also useful for integration tests and offline distributions. */
export function startStdio(): void {
  let buffer = Buffer.alloc(0);
  let queue = Promise.resolve();
  const send = (message: unknown) => {
    const body = Buffer.from(JSON.stringify(message));
    process.stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
    process.stdout.write(body);
  };
  const server = new LanguageServer({
    notify: (method, params) => send({ jsonrpc: '2.0', method, params }),
  });
  process.stdin.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      const split = buffer.indexOf('\r\n\r\n');
      if (split < 0) {
        if (buffer.length > 8192) {
          process.stderr.write('Oversized LSP header\n');
          process.exitCode = 1;
          process.stdin.destroy();
        }
        break;
      }
      const match = /content-length:\s*(\d+)/i.exec(buffer.subarray(0, split).toString('ascii'));
      const length = match ? Number(match[1]) : -1;
      if (length < 0 || length > 16 * 1024 * 1024) {
        process.stderr.write('Invalid LSP Content-Length\n');
        process.exitCode = 1;
        process.stdin.destroy();
        return;
      }
      if (buffer.length < split + 4 + length) break;
      const body = buffer.subarray(split + 4, split + 4 + length);
      buffer = buffer.subarray(split + 4 + length);
      queue = queue.then(async () => {
        let message: Wire;
        try {
          message = JSON.parse(body.toString('utf8'));
          const result = await server.request(message.method, message.params);
          if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: result ?? null });
          if (message.method === 'exit') process.stdin.destroy();
        } catch (error) {
          if (message?.id !== undefined)
            send({
              jsonrpc: '2.0',
              id: message.id,
              error: { code: -32603, message: (error as Error).message },
            });
          else process.stderr.write(`gneh-lsp: ${(error as Error).message}\n`);
        }
      });
    }
  });
  process.stdin.resume();
}

/** Prefer the ecosystem transport; the protocol and language service remain the same. */
export async function startServer(): Promise<void> {
  if (process.env.GNEH_LSP_TRANSPORT === 'builtin') {
    startStdio();
    return;
  }
  let lsp: typeof import('vscode-languageserver/node');
  try {
    lsp = await import('vscode-languageserver/node');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ERR_MODULE_NOT_FOUND') throw error;
    startStdio();
    return;
  }
  const connection = lsp.createConnection(lsp.ProposedFeatures.all, process.stdin, process.stdout);
  const server = new LanguageServer({
    notify: (method, params) => connection.sendNotification(method, params),
  });
  connection.onInitialize(
    (params) => server.request('initialize', params) as Promise<import('vscode-languageserver').InitializeResult>,
  );
  connection.onInitialized(() => void server.request('initialized'));
  connection.onShutdown(() => server.request('shutdown') as Promise<void>);
  connection.onExit(() => {
    void server.request('exit');
    connection.dispose();
  });
  connection.onRequest((method, params) => server.request(method, params));
  connection.onNotification((method, params) => {
    void server.request(method, params).catch((error) => connection.console.error(String(error)));
  });
  connection.listen();
}
