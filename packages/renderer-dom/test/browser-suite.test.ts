/** Browser conformance for the independently built Vite applications. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { test } from 'vitest';

test('independently built Vite applications conform in a real browser', { timeout: 120_000 }, async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const sites = new Map([
    ['starter', path.join(root, 'packages/create/template/dist')],
    ['playground', path.join(root, 'examples/playground/dist')],
    ['snapshot', path.join(root, 'examples/snapshot/dist')],
    ['opinion-wiki', path.join(root, 'examples/opinion-wiki/dist')],
  ]);
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
    const [, site, ...rest] = pathname.split('/');
    const directory = sites.get(site);
    if (!directory) return response.writeHead(404).end();
    let file = path.join(directory, ...rest);
    if (!file.startsWith(directory)) return response.writeHead(403).end();
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
    timeout: 60_000,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
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
    check(
      await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement).backgroundColor;
        return (
          document.documentElement.dataset.gnehEnvironment === 'wiki' &&
          root === getComputedStyle(document.body).backgroundColor &&
          root !== 'rgba(0, 0, 0, 0)'
        );
      }),
      'starter: presentation environment colors the complete page',
    );
    check(
      (await page.$eval('article', (node) => node.getBoundingClientRect().width)) > 800,
      'starter: story content is not capped at 800 pixels',
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
      await page.evaluate(
        () =>
          document.documentElement.dataset.gnehEnvironment === 'visual-novel' &&
          getComputedStyle(document.body).backgroundColor === 'rgb(16, 23, 39)',
      ),
      'starter: switching presentation updates the page background',
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

    page = await pageAt('/playground/');
    await page.waitForFunction(() => window.gnehApp?.story);
    check(
      (await page.$eval('#story h1', (node) => node.textContent)) === 'The House at the End of Night',
      'playground: production HTML boots the Inkdown entry passage',
    );
    await page.locator(aria('button', 'Steep the midnight tea')).click();
    check(
      await page.evaluate(() => window.gnehApp.story.state.hasTea === true && window.gnehApp.story.state.warmth === 1),
      'playground: Inkdown actions update the shared story state',
    );
    await page.locator(aria('link', 'Enter the reading room - Karlowe →')).click();
    check(
      (await page.$eval('#story h1', (node) => node.textContent)) === 'The room that reads you',
      'playground: production HTML navigates into Karlowe',
    );
    await page.locator(aria('link', 'Return to the entrance →')).click();
    await page.locator(aria('link', 'Enter the vault - Sugarcast →')).click();
    check(
      (await page.$eval('#story', (node) => node.textContent)).includes('The guest beneath the stairs'),
      'playground: production HTML navigates into Sugarcast',
    );
    await page.setViewport({ width: 390, height: 844 });
    check(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
      'playground: story chrome has no horizontal overflow on a narrow screen',
    );
    await page.close();

    page = await pageAt('/snapshot/');
    await page.waitForFunction(() => window.gnehApp?.story);
    check(
      (await page.$eval('#story h1', (node) => node.textContent)) === 'A document without live behavior',
      'snapshot: production HTML boots the static entry passage',
    );
    await page.locator(aria('link', 'Next page')).click();
    check(
      (await page.$eval('#story h1', (node) => node.textContent)) === 'Second page',
      'snapshot: production HTML keeps passage navigation',
    );
    await page.close();

    page = await pageAt('/opinion-wiki/');
    await page.waitForFunction(() => window.gnehApp?.story);
    check(
      (await page.$eval('#app-context', (node) => node.textContent)).includes('surrounding Vite application'),
      'opinion Wiki: unrelated Markdown remains owned by the surrounding frontend',
    );
    check(
      (await page.$eval('#story h1', (node) => node.textContent)).includes('opinions and networks'),
      'opinion Wiki: compiled Inkdown mounts inside application-owned chrome',
    );
    await page.locator('#wiki-navigation button[data-passage=Recommendation]').click();
    check(
      await page.$eval('.math-block', (node) => node.querySelector('.katex') !== null),
      'opinion Wiki: imported defineView output is rendered through the LaTeX DOM plugin',
    );
    await page.locator('#wiki-navigation button[data-passage=Primer]').click();
    await page.locator(aria('link', 'Open the interactive concept lab')).click();
    const before = await page.evaluate(() => window.gnehApp.story.state.confidence);
    await page.locator(aria('button', 'Widen +0.05')).click();
    check(
      await page.evaluate((value) => window.gnehApp.story.state.confidence > value, before),
      'opinion Wiki: a handwritten JavaScript passage shares runtime state with compiled Inkdown',
    );
    check(
      await page.evaluate(() => document.querySelector('#wiki-navigation').isConnected),
      'coexistence: mounting the Wiki preserves sibling application roots',
    );
    await page.screenshot({
      path: path.join(reportDirectory, 'opinion-wiki.png'),
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
