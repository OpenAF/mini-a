// Real upstream editor acceptance, run with tests/webDrawioHttp.py.
// Playwright is an explicitly supplied development dependency, not a shipped runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const {chromium, firefox, webkit} = require('playwright');
const origin = process.env.MINIA_TEST_URL, token = process.env.MINIA_TEST_TOKEN;
const diagnostics = process.env.MINIA_DRAWIO_DIAGNOSTICS;
const engine = process.argv[2] || 'chromium';
if (!origin || !token || !diagnostics) throw new Error('Run through tests/webDrawioHttp.py');
const diagram = '<mxfile compressed="false"><diagram id="p1" name="Main"><mxGraphModel dx="800" dy="600" page="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="n1" value="Initial label" style="rounded=0;html=0;" vertex="1" parent="1"><mxGeometry x="80" y="80" width="160" height="60" as="geometry"/></mxCell><mxCell id="n2" value="Untouched" style="html=0;" vertex="1" parent="1"><mxGeometry x="350" y="80" width="120" height="60" as="geometry"/></mxCell><mxCell id="e1" edge="1" source="n1" target="n2" parent="1"><mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="290" y="110"/></Array></mxGeometry></mxCell></root></mxGraphModel></diagram></mxfile>';

(async () => {
  const launch = {headless:true,timeout:60000};
  if (engine === 'chromium' && process.env.MINIA_CHROME_PATH) launch.executablePath = process.env.MINIA_CHROME_PATH;
  const browser = await ({chromium, firefox, webkit}[engine]).launch(launch);
  const context = await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  const page = await context.newPage();
  page.setDefaultTimeout(60000);
  const logs = [], external = [], guestExternal = [];
  page.on('pageerror', error => logs.push({type:'pageerror',message:error.message}));
  page.on('console', message => { if (message.type() === 'error' || message.type() === 'warning') logs.push({type:message.type(),message:message.text()}); });
  page.on('requestfailed', request => logs.push({type:'requestfailed',url:request.url(),error:request.failure()}));
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin || ['data:','blob:'].includes(url.protocol)) return route.continue();
    external.push(url.origin);
    try { if (route.request().frame().url().includes('/web-extension-assets/')) guestExternal.push(url.href); } catch (_) {}
    return route.abort();
  });
  const editor = () => page.locator('dialog').filter({has:page.locator('.mini-a-extension-stage')}).last();
  const embedded = () => editor().frameLocator('iframe').frameLocator('iframe').frameLocator('iframe');
  async function ready() { await editor().getByRole('status').filter({hasText:/^(Saved|Unsaved changes)$/}).waitFor(); }
  async function editLabel(previous, next) {
    const graph = embedded(), target = graph.getByText(previous,{exact:true}).last();
    await target.waitFor();
    const local = await target.evaluate(node=>node.getBoundingClientRect().toJSON());
    const outer = await editor().locator('iframe').boundingBox();
    const guest = await editor().frameLocator('iframe').locator('iframe').evaluate(node=>node.getBoundingClientRect().toJSON());
    const child = await editor().frameLocator('iframe').frameLocator('iframe').locator('iframe').evaluate(node=>node.getBoundingClientRect().toJSON());
    assert.ok(outer && local.width > 0, 'Diagram label has a visible browser box');
    // WebKit's nested SVG boundingBox can omit frame offsets. Sum each viewport explicitly.
    const box = {x:outer.x+guest.x+child.x+local.x,y:outer.y+guest.y+child.y+local.y,width:local.width,height:local.height};
    fs.writeFileSync(path.join(diagnostics,'drawio-click-'+previous.replace(/\W/g,'')+'.json'),JSON.stringify({box,local,outer,guest,child},null,2));
    // SVG text can intentionally have pointer-events:none; click its rendered cell.
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
    const label = graph.locator('[contenteditable=true]').last();
    await label.waitFor(); await label.fill(next);
    await graph.locator('.geDiagramContainer').click({position:{x:20,y:250}});
    await graph.getByText(next,{exact:true}).last().waitFor();
  }
  async function download(button) {
    const waiting = page.waitForEvent('download', {timeout:20000});
    await editor().getByRole('button', {name:button,exact:true}).click();
    const result = await waiting, input = await result.createReadStream(), chunks = [];
    for await (const chunk of input) chunks.push(chunk);
    return Buffer.concat(chunks);
  }
  try {
    await page.goto(origin + '/#token=' + encodeURIComponent(token), {waitUntil:'domcontentloaded'});
    await page.getByRole('button',{name:'Extensions',exact:true}).click();
    const manager = page.getByRole('dialog',{name:'Extensions',exact:true});
    await manager.getByRole('button',{name:'New',exact:true}).click();
    await ready();
    await editor().getByRole('button',{name:'Save',exact:true}).click();
    await editor().getByRole('status').filter({hasText:/^Saved$/}).waitFor();
    await editor().getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('.mini-a-extension-stage').waitFor({state:'detached'});
    console.log('PASS '+engine+': blank create/save/close');
    await manager.locator('input[type=file]').setInputFiles({name:'roundtrip.drawio',mimeType:'application/vnd.jgraph.mxfile',buffer:Buffer.from(diagram)});
    await ready();
    const graph = embedded();
    await graph.getByText('Initial label',{exact:true}).last().waitFor();
    const boundary = await graph.locator('body').evaluate(() => {
      let parentDenied = false, storageDenied = false;
      try { void parent.document.body; } catch (_) { parentDenied = true; }
      try { localStorage.getItem('anything'); } catch (_) { storageDenied = true; }
      return {origin:self.origin,parentDenied,storageDenied};
    });
    assert.deepEqual(boundary,{origin:'null',parentDenied:true,storageDenied:true});
    const nodeFlood = zlib.deflateRawSync(Buffer.from(encodeURIComponent('<mxGraphModel><root>'+'<x/>'.repeat(16000)+'</root></mxGraphModel>'))).toString('base64');
    const aggregate = '<mxfile><diagram id="a">'+nodeFlood+'</diagram><diagram id="b">'+nodeFlood+'</diagram></mxfile>';
    const admission = await editor().frameLocator('iframe').frameLocator('iframe').locator('body').evaluate(async aggregate => {
      const native = window.MiniADrawioNative;
      const stripped = native.safeSvg('<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://invalid.test)</style><rect fill="#ffffff" style="fill:red" width="10" height="10"/></svg>');
      const rejected = [];
      for (const input of ['<!DOCTYPE mxfile [<!ENTITY x SYSTEM "file:///private">]><mxfile>&x;</mxfile>', '<mxGraphModel><root><mxCell id="a" style="image=https://invalid.test/a"/></root></mxGraphModel>', aggregate]) {
        try { await native.normalize(input); rejected.push(false); } catch (_) { rejected.push(true); }
      }
      for (const input of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>', '<svg xmlns="http://www.w3.org/2000/svg"><use href="https://invalid.test/a"/></svg>']) {
        try { native.safeSvg(input); rejected.push(false); } catch (_) { rejected.push(true); }
      }
      return {stripped,rejected};
    }, aggregate);
    assert.doesNotMatch(admission.stripped,/<style|style=/);
    assert.match(admission.stripped,/fill="#ffffff"/);
    assert.deepEqual(admission.rejected,[true,true,true,true,true]);
    await editLabel('Initial label', 'Edited label');
    await editor().getByRole('button',{name:'Save',exact:true}).click();
    await editor().getByRole('status').filter({hasText:/^Saved$/}).waitFor();
    console.log('PASS '+engine+': opaque boundary and native import/edit/save');
    await editor().frameLocator('iframe').frameLocator('iframe').locator('body').evaluate(() => {
      window.addEventListener('message', event => {
        if (event.source !== document.querySelector('iframe').contentWindow || typeof event.data !== 'string') return;
        try { const message = JSON.parse(event.data); if (message.event === 'export' && message.format === 'svg') window.__testSvg = message.data; } catch (_) {}
      });
    });
    const svg = await download('Export SVG');
    assert.match(svg.toString(),/<svg[\s>]/);
    assert.doesNotMatch(svg.toString(),/<script|<foreignObject|<style/i);
    const png = await download('Export PNG');
    assert.deepEqual(png.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]));
    console.log('PASS '+engine+': passive SVG and PNG exports');
    await editor().getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('.mini-a-extension-stage').waitFor({state:'detached'});
    await manager.getByRole('button',{name:'Refresh installed extensions',exact:true}).click();
    const saved = manager.locator('section').filter({has:page.getByRole('heading',{name:'roundtrip.drawio',exact:true})});
    await saved.getByRole('button',{name:'Open with',exact:true}).click();
    await ready();
    await embedded().getByText('Edited label',{exact:true}).last().waitFor();
    await embedded().getByText('Untouched',{exact:true}).last().waitFor();
    await editLabel('Edited label', 'Unsaved label');
    await editor().getByRole('status').filter({hasText:/^Unsaved changes$/}).waitFor();
    await editor().getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('dialog',{name:'Save changes before closing?'}).getByRole('button',{name:'Cancel',exact:true}).click();
    await embedded().getByText('Unsaved label',{exact:true}).last().waitFor();
    await editor().getByRole('button',{name:'Close',exact:true}).click();
    await page.getByRole('dialog',{name:'Save changes before closing?'}).getByRole('button',{name:'Discard',exact:true}).click();
    await page.locator('.mini-a-extension-stage').waitFor({state:'detached'});
    const nativeDownload = page.waitForEvent('download');
    await saved.getByRole('button',{name:'Download native',exact:true}).click();
    const native = await nativeDownload, nativeStream = await native.createReadStream(), nativeChunks = [];
    for await (const chunk of nativeStream) nativeChunks.push(chunk);
    const xml = Buffer.concat(nativeChunks).toString();
    assert.match(xml,/Edited label/); assert.match(xml,/id="n1"/); assert.match(xml,/id="n2"/); assert.match(xml,/id="e1"/);
    assert.match(xml,/x="350"/); assert.match(xml,/x="290"/);
    assert.doesNotMatch(xml,/Unsaved label/);
    const model = diagram.match(/<mxGraphModel[\s\S]*<\/mxGraphModel>/)[0].replace('Initial label','Compressed Ω label');
    const compressed = zlib.deflateRawSync(Buffer.from(encodeURIComponent(model))).toString('base64');
    const compressedDiagram = '<mxfile><diagram id="compressed-page" name="Compressed">'+compressed+'</diagram><diagram id="second-page" name="Second">'+compressed+'</diagram></mxfile>';
    await manager.locator('input[type=file]').setInputFiles({name:'compressed.drawio',mimeType:'application/vnd.jgraph.mxfile',buffer:Buffer.from(compressedDiagram)});
    await ready();
    await embedded().getByText('Compressed Ω label',{exact:true}).last().waitFor();
    await editor().getByRole('button',{name:'Save',exact:true}).click();
    await editor().getByRole('status').filter({hasText:/^Saved$/}).waitFor();
    const expanded = await download('Save native copy');
    assert.match(expanded.toString(),/Compressed Ω label/);
    assert.match(expanded.toString(),/id="second-page"/);
    await editor().getByRole('button',{name:'Close',exact:true}).click();
    await page.locator('.mini-a-extension-stage').waitFor({state:'detached'});
    assert.deepEqual(guestExternal,[],'No extension external requests');
    assert.equal(page.frames().filter(frame=>frame.url().includes('/web-extension-assets/')).length,0,'Editor frames unloaded');
    console.log('PASS '+engine+': real pinned draw.io opaque create/import/edit/save/reopen/SVG/PNG, compressed Unicode, dirty cancel/discard, native fidelity and unload without an LLM');
  } catch (error) {
    for (const frame of page.frames()) {
      const svg = await frame.evaluate(() => window.__testSvg).catch(()=>null);
      if (typeof svg === 'string') fs.writeFileSync(path.join(diagnostics,'raw-export-svg.txt'),svg);
    }
    await page.screenshot({path:path.join(diagnostics,'drawio-failure.png'),fullPage:true}).catch(()=>{});
    fs.writeFileSync(path.join(diagnostics,'drawio-failure.txt'),await page.locator('body').innerText().catch(()=>''));
    throw error;
  } finally {
    fs.writeFileSync(path.join(diagnostics,'drawio-browser.json'),JSON.stringify({logs,external,guestExternal},null,2));
    await context.close(); await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1});
