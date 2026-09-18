/** Browser conformance for the generated Vite applications. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { test } from 'vitest';

test('generated Vite applications conform in a real browser', { timeout: 60_000 }, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const demo = path.join(root, 'demo');
  const reportDirectory = path.join(root, 'verification');
  fs.mkdirSync(reportDirectory, { recursive: true });
  const checks = [];
  const errors = [];

  function check(condition, name) {
    if (!condition) throw new Error(name);
    checks.push(name);
    console.log('PASS', name);
  }

  function executablePath() {
    const configured = process.env.GNEH_CHROMIUM ?? process.env.PUPPETEER_EXECUTABLE_PATH;
    if (configured) return configured;
    for (const command of ['chromium', 'chromium-browser', 'google-chrome']) {
      try {
        return execFileSync('which', [command], { encoding: 'utf8' }).trim();
      } catch {}
    }
    const candidates =
      process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium'];
    const found = candidates.find((candidate) => fs.existsSync(candidate));
    if (found) return found;
    throw new Error('No Chrome/Chromium executable found; set GNEH_CHROMIUM.');
  }

  function aria(role, name) {
    return `::-p-aria([name=${JSON.stringify(name)}][role=${JSON.stringify(role)}])`;
  }

  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.map': 'application/json',
  };
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    let file = path.join(demo, pathname);
    if (!file.startsWith(demo)) return response.writeHead(403).end();
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) return response.writeHead(404).end();
    response.setHeader('content-type', types[path.extname(file)] ?? 'application/octet-stream');
    fs.createReadStream(file).pipe(response);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  const browser = await puppeteer.launch({
    browser: 'chrome',
    executablePath: executablePath(),
    headless: true,
    args: ['--no-sandbox'],
  });

  async function pageAt(pathname, viewport = { width: 1280, height: 900 }) {
    const page = await browser.newPage();
    await page.setViewport(viewport);
    page.on('pageerror', (error) => errors.push(String(error)));
    await page.goto(origin + pathname, { waitUntil: 'networkidle0' });
    return page;
  }

  try {
    let page = await pageAt('/starter/?environment=wiki');
    await page.waitForFunction(() => window.gnehApp?.story);
    check(
      (await page.$eval('h1', (node) => node.textContent)) === 'A new story',
      'starter: Vite compiles the configured story graph',
    );
    check(
      await page.$eval('.gneh-app', (node) => node.dataset.environment === 'wiki'),
      'starter: presentation starts from application-owned options',
    );
    await page.locator(aria('button', 'Visit again')).click();
    check(
      await page.evaluate(() => window.gnehApp.story.state.visits === 1),
      'starter: action updates shared runtime state',
    );
    await page.locator(aria('button', 'Save')).click();
    await page.locator(aria('button', 'Visit again')).click();
    await page.locator(aria('button', 'Load')).click();
    check(
      await page.evaluate(() => window.gnehApp.story.state.visits === 1),
      'starter: editable template save/load controls work',
    );
    await page.select('select', 'visual-novel');
    check(
      await page.$eval('.gneh-app', (node) => node.dataset.environment === 'visual-novel'),
      'starter: template owns environment switching',
    );
    check(
      await page.$eval('footer', (node) => getComputedStyle(node).display === 'flex'),
      'starter: visual-novel presentation is template CSS, not runtime policy',
    );
    await page.screenshot({ path: path.join(reportDirectory, 'starter.png'), fullPage: true });
    await page.close();

    page = await pageAt('/starter/?environment=story-flow', { width: 390, height: 844 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'starter: responsive template has no horizontal page overflow',
    );
    await page.close();

    page = await pageAt('/vite-app/');
    await page.waitForFunction(() => window.app?.story);
    check(
      (await page.$eval('#existing-app', (node) => node.textContent)).includes('surrounding frontend'),
      'Vite: unrelated Markdown remains owned by the surrounding frontend',
    );
    check(
      (await page.$eval('#story h1', (node) => node.textContent)).includes('Markdown'),
      'Vite: gneh mounts beside existing DOM instead of owning the page',
    );
    const before = await page.evaluate(() => window.app.story.state.count);
    await page.locator(aria('button', 'Increment')).click();
    check(
      await page.evaluate((value) => window.app.story.state.count === value + 1, before),
      'Vite: handwritten JavaScript fragments coexist with compiled Inkdown',
    );
    check(
      await page.evaluate(() => window.gnehTest.safeURL('javascript:alert(1)') === ''),
      'DOM backend: unsafe URL schemes remain rejected',
    );
    check(
      await page.evaluate(() => document.querySelector('#existing-app').isConnected),
      'coexistence: mounting a story preserves sibling application roots',
    );
    await page.screenshot({
      path: path.join(reportDirectory, 'vite-coexistence.png'),
      fullPage: true,
    });
    await page.close();
  } finally {
    await browser.close();
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }

  check(errors.length === 0, 'all browser scenarios: no uncaught JavaScript errors');
  fs.writeFileSync(
    path.join(reportDirectory, 'browser-results.json'),
    JSON.stringify({ passed: checks.length, failed: 0, checks, errors }, null, 2) + '\n',
  );
  console.log(JSON.stringify({ passed: checks.length, failed: 0 }));
});
