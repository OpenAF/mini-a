// NODE_PATH=<Playwright node_modules> node tests/browser/diagramMenus.spec.cjs [webkit|chromium]
// Isolated rendering fixture: uses production controls and styles, no model/server required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { webkit, chromium } = require('playwright');
const source = fs.readFileSync(path.join(__dirname, '../../public/index.md'), 'utf8');
const advancedCss = fs.readFileSync(path.join(__dirname, '../../public/advanced.css'), 'utf8');
const take = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
const css = take('<style>', '</style>') + advancedCss + '</style>';
const functions = take('    function openMermaidFullscreen(', '    async function renderMermaidDiagrams(') +
  take('    function addSvgDownloadControl(', '    function sanitizeSvgContent(');
const engine = process.argv[2] || 'webkit';
(async () => {
  const browser = await ({ webkit, chromium }[engine]).launch({ headless: true,
    ...(engine === 'chromium' && process.env.MINIA_CHROME_PATH ? { executablePath: process.env.MINIA_CHROME_PATH } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: true, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => { errors.push(error.message); console.error(error.message); });
    for (const advanced of [false, true]) {
      const html = '<meta name="viewport" content="width=device-width, initial-scale=1">' + css +
        (advanced ? '<div class="advanced-shell" style="--advanced-size:100"><nav>Fixture</nav><header>Results</header><div class="advanced-screen advanced-reader" id="fixture"></div></div>' :
          '<div class="chat-container"><div id="resultsDiv"><div id="fixture"></div></div></div>') +
        '<script>' + functions + `
          const svgText = '<svg xmlns="http://www.w3.org/2000/svg" width="500" height="100" viewBox="0 0 500 100"><rect width="500" height="100" fill="lightblue"/></svg>';
          for (const kind of ['SVG', 'Mermaid', 'Inline Mermaid']) {
            const container = document.createElement('div'); container.id = 'diagram-' + kind.replace(/ /g, '-');
            document.getElementById('fixture').appendChild(container);
            if (kind === 'Inline Mermaid') { container.className = 'mermaid-diagram'; container.innerHTML = svgText; addMermaidPanZoomLayer(container); }
            else if (kind === 'SVG') {
              container.className = 'svg-rendered-block';
              const viewport = document.createElement('div'); viewport.className = 'svg-viewport';
              const image = document.createElement('img'); image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
              viewport.appendChild(image); container.appendChild(viewport); addSvgDownloadControl(container, svgText);
            } else renderMermaidPreview(container, svgText);
            const spacer = document.createElement('p'); spacer.textContent = 'Following content'; spacer.style.height = '350px';
            document.getElementById('fixture').appendChild(spacer);
          }
        </script>`;
      await page.route('http://mini-a.test/', route => route.fulfill({ contentType: 'text/html', body: html }));
      await page.goto('http://mini-a.test/');
      for (const kind of ['SVG', 'Mermaid', 'Inline-Mermaid']) {
        const diagram = page.locator('#diagram-' + kind);
        const menu = diagram.locator('details');
        const trigger = menu.locator('summary');
        const open = async () => { await trigger.tap(); assert.equal(await menu.getAttribute('open'), ''); };
        const image = diagram.locator(kind === 'Inline-Mermaid' ? '.mermaid-panzoom-content svg' : 'img');
        const before = await image.boundingBox();
        await open();
        const zoom = menu.getByRole('button', { name: kind === 'SVG' ? 'Enlarge SVG' : 'Zoom in', exact: true });
        const menuBox = await menu.boundingBox(), zoomBox = await zoom.boundingBox();
        assert.ok(zoomBox.y + zoomBox.height <= menuBox.y + menuBox.height + 1, 'Menu hit area contains its actions');
        await zoom.tap({ timeout: 3000 });
        assert.equal(await menu.getAttribute('open'), null, 'Action closes menu after tap');
        if (kind !== 'Inline-Mermaid') assert.ok((await image.boundingBox()).width > before.width, 'Tap zooms image');
        await open(); await menu.getByRole('button', { name: kind === 'SVG' ? 'Reset SVG size' : 'Reset view', exact: true }).tap();
        await open(); await page.keyboard.press('Escape');
        assert.equal(await menu.getAttribute('open'), null, 'Escape closes the menu');
        await open(); await page.locator('#fixture > p').first().tap();
        assert.equal(await menu.getAttribute('open'), null, 'Outside tap closes the menu');
        for (const format of ['SVG', 'PNG']) {
          await open();
          const [download] = await Promise.all([page.waitForEvent('download', { timeout: 5000 }),
            menu.getByRole('button', { name: new RegExp('^Download ' + format) }).tap()]).catch(async error => { console.error(await diagram.innerText()); throw error; });
          assert.match(download.suggestedFilename(), new RegExp('\\.' + format.toLowerCase() + '$'));
        }
        await open(); await menu.getByRole('button', { name: 'Open full screen', exact: true }).tap();
        const dialog = page.locator('dialog[open]');
        await dialog.getByRole('button', { name: 'Zoom in', exact: true }).tap();
        await dialog.getByRole('button', { name: 'Close full screen', exact: true }).tap();
        assert.equal(await dialog.count(), 0);
        console.log(engine + ': ' + (advanced ? 'Advanced ' : 'Simple ') + kind + ' touch actions passed');
      }
      await page.unroute('http://mini-a.test/');
    }
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
