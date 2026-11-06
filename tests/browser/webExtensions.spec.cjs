// Real browser acceptance; run via tests/webExtensionsHttp.py --browser <engine>.
// Playwright is a development dependency supplied with NODE_PATH, not an oPack dependency.
const assert = require('node:assert/strict');
const { chromium, firefox, webkit } = require('playwright');
const origin = process.env.MINIA_TEST_URL;
const token = process.env.MINIA_TEST_TOKEN;
const name = process.argv[2] || 'chromium';
if (!origin || !token) throw new Error('Use tests/webExtensionsHttp.py to start an isolated test server');

(async () => {
  let stage = 'launch';
  const progress = value => { stage = value; if (process.env.MINIA_TEST_PROGRESS) console.log(name + ': ' + value); };
  const launch = { headless: true, timeout: 30000 };
  if (name === 'chromium' && process.env.MINIA_CHROME_PATH) launch.executablePath = process.env.MINIA_CHROME_PATH;
  const browser = await ({ chromium, firefox, webkit }[name]).launch(launch);
  progress('browser launched');
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [], external = [], guestExternal = [], guestApi = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    const target = new URL(route.request().url());
    try {
      if (route.request().frame().url().includes('/web-extension-assets/') && target.origin === origin && !target.pathname.includes('/web-extension-assets/')) guestApi.push(target.pathname);
    } catch (_) {}
    if (target.origin === origin || ['data:', 'blob:'].includes(target.protocol)) return route.continue();
    external.push(target.origin);
    try { if (route.request().frame().url().includes('/web-extension-assets/')) guestExternal.push(target.origin); } catch (_) {}
    return route.abort();
  });
  try {
    progress('load workspace');
    await page.goto(origin + '/#token=' + encodeURIComponent(token), { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Extensions', exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await page.locator('#promptInput').isDisabled(), true, 'model-free composer disabled');
    await page.getByRole('button', { name: 'Extensions', exact: true }).click();
    const manager = page.getByRole('dialog', { name: 'Extensions', exact: true });
    await manager.getByRole('button', { name: 'New', exact: true }).click();
    progress('open editor');
    const editor = page.locator('dialog').filter({ has: page.locator('.mini-a-extension-stage') }).last();
    const guest = editor.frameLocator('iframe').frameLocator('iframe');
    const textarea = guest.locator('textarea');
    await textarea.waitFor({ timeout: 30000 });
    await textarea.fill('Browser round trip — no LLM');
    const boundary = await textarea.evaluate(node => {
      let parentDenied = false, storageDenied = false;
      try { void parent.document.body; } catch (_) { parentDenied = true; }
      try { localStorage.getItem('mini-a-web-token'); } catch (_) { storageDenied = true; }
      return { parentDenied, storageDenied, origin: self.origin };
    });
    assert.equal(boundary.parentDenied, true, 'guest cannot read host/container DOM');
    assert.equal(boundary.storageDenied, true, 'guest has no origin storage');
    assert.equal(boundary.origin, 'null', 'guest opaque origin');
    progress('negative network checks');
    const denied = await textarea.evaluate(async () => {
      let hostFetchDenied = false, topDenied = false, popupDenied = false, imageDenied = false;
      try { await fetch(new URL('/web-extensions', location.href).href); } catch (_) { hostFetchDenied = true; }
      try { void top.document.body; } catch (_) { topDenied = true; }
      popupDenied = window.open('https://mini-a-exfil.invalid/popup', '_blank') === null;
      imageDenied = await new Promise(resolve => {
        const image = new Image(); image.onerror = () => resolve(true); image.onload = () => resolve(false);
        image.src = 'https://mini-a-exfil.invalid/document.png';
        setTimeout(() => resolve(false), 1000);
      });
      return { hostFetchDenied, topDenied, popupDenied, imageDenied };
    });
    assert.deepEqual(denied, { hostFetchDenied: true, topDenied: true, popupDenied: true, imageDenied: true }, 'CSP and sandbox deny host API fetch, top DOM, popup and remote image');
    progress('save native');
    await editor.getByRole('button', { name: 'Save', exact: true }).click();
    await editor.getByRole('status').filter({ hasText: /^Saved$/ }).waitFor();
    await textarea.fill('Unsaved edit');
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    const confirmation = page.getByRole('dialog', { name: 'Save changes before closing?' });
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    assert.equal(await textarea.inputValue(), 'Unsaved edit', 'cancel retains working copy');
    await editor.getByRole('button', { name: 'Close', exact: true }).click();
    await confirmation.getByRole('button', { name: 'Discard', exact: true }).click();
    await editor.waitFor({ state: 'detached' });
    progress('reopen native');
    await manager.getByRole('button', { name: 'Refresh installed extensions', exact: true }).click();
    const savedRow = manager.locator('section').filter({ has: page.getByRole('heading', { name: 'Untitled', exact: true }) });
    await savedRow.getByRole('button', { name: 'Open with', exact: true }).click();
    const reopened = page.locator('dialog').filter({ has: page.locator('.mini-a-extension-stage') }).last();
    const reopenedText = reopened.frameLocator('iframe').frameLocator('iframe').locator('textarea');
    await reopenedText.waitFor();
    assert.equal(await reopenedText.inputValue(), 'Browser round trip — no LLM', 'saved native content reopens');
    progress('export');
    const downloadPromise = page.waitForEvent('download');
    await reopened.getByRole('button', { name: 'Export TXT', exact: true }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks = []; for await (const chunk of stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), 'Browser round trip — no LLM');
    await reopened.getByRole('button', { name: 'Close', exact: true }).click();
    await reopened.waitFor({ state: 'detached' });
    assert.equal(page.frames().filter(frame => frame.url().includes('/web-extension-assets/')).length, 0, 'guest unloaded');
    assert.deepEqual(guestExternal, [], 'extension requires no external network');
    assert.deepEqual(guestApi, [], 'guest cannot issue requests to privileged host routes');
    const relevant = errors.filter(message => /MiniAWebExtension|web-extension|Extension/.test(message));
    assert.deepEqual(relevant, [], 'no extension runtime errors');
    console.log('PASS ' + name + ': opaque isolation, model-free create/edit/save/reopen/export, cancel/discard and unload');
    if (external.length) console.log('Existing shell CDN requests blocked during offline workflow: ' + [...new Set(external)].join(', '));
  } catch (error) {
    console.error('Browser diagnostics: ' + JSON.stringify({
      engine: name,
      stage,
      status: await page.getByRole('status').allTextContents().catch(() => []),
      frames: page.frames().map(frame => { try { const value = new URL(frame.url()); return value.origin + value.pathname; } catch (_) { return 'unloaded'; } }),
      errors
    }));
    throw error;
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
