// Drive an isolated Chrome profile over its private DevTools pipe. No browser package required.
const {spawn} = require('node:child_process')
const {writeFileSync} = require('node:fs')
const {join} = require('node:path')
const assert = require('node:assert/strict')
const [origin, token, theme, width, temp] = process.argv.slice(2)
const name = 'browser-' + theme + '-' + width
const chrome = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const child = spawn(chrome, ['--headless=new', '--disable-background-networking', '--no-first-run',
  '--disable-default-apps', '--no-default-browser-check', '--remote-debugging-pipe',
  '--user-data-dir=' + join(temp, name), 'about:blank'], {stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe']})
let seq = 0, buffer = '', sessionId
const pending = new Map()
child.stdio[4].setEncoding('utf8')
child.stdio[4].on('data', chunk => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf('\0')) >= 0) {
    const msg = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    if (pending.has(msg.id)) {
      const {resolve, reject} = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(Error(msg.error.message))
      else resolve(msg.result)
    }
  }
})
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq
  pending.set(id, {resolve, reject})
  child.stdio[3].write(JSON.stringify({id, method, params, sessionId}) + '\0')
})
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', {expression, returnByValue: true})
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text)
  return result.result.value
}
async function wait(expression) {
  for (let i = 0; i < 240; i++) {
    if (await evaluate(expression)) return
    await delay(200)
  }
  throw Error('Timed out waiting for ' + expression + '\n' + (await evaluate('document.body.innerText')).slice(-1200))
}
async function click(title) {
  const target = 'btn(' + JSON.stringify(title) + ')'
  await wait(target + ' && !' + target + '.disabled')
  await evaluate(target + '.click()')
}
async function select(label, text) {
  const target = 'input(' + JSON.stringify(label) + ')'
  const option = '[...' + target + '.options].find(o => o.textContent.startsWith(' + JSON.stringify(text) + '))'
  await wait(target + ' && ' + option)
  await evaluate('set(' + target + ',' + option + '.value)')
}
async function test() {
  const {targetId} = await cdp('Target.createTarget', {url:'about:blank'})
  sessionId = (await cdp('Target.attachToTarget', {targetId, flatten:true})).sessionId
  await cdp('Emulation.setDeviceMetricsOverride', {width:+width, height:900, deviceScaleFactor:1, mobile:false})
  await cdp('Emulation.setEmulatedMedia', {features:[{name:'prefers-color-scheme', value:theme}]})
  await cdp('Page.navigate', {url:origin + '/#token=' + token})
  await wait('document.body?.innerText.includes("Your wikis")')
  await evaluate(`window.btn = t => [...document.querySelectorAll("button")].find(b => b.textContent.trim() === t)
    window.input = t => [...document.querySelectorAll("label")].find(l => [...l.childNodes].some(n => n.nodeType === 3 && n.textContent.trim() === t))?.querySelector("input,select,textarea")
    window.set = (node,value) => {node.value = value;node.dispatchEvent(new Event("input",{bubbles:true}));node.dispatchEvent(new Event("change",{bubbles:true}))}`)
  await click('B · Editable')
  await wait('document.querySelector("#wiki-nav") && !navigating')
  await click('Import')
  await click('Add source')
  await select('Source method', 'MCP tool call')
  await evaluate('set(input("Source name"),' + JSON.stringify(name) + ')')
  await select('Connection', 'Launch')
  await select('Tool', 'Launch · counter · report')
  assert.equal(await evaluate('input("Connection").selectedOptions[0].textContent'), 'Launch · counter')
  await evaluate('input("Include enabled").click();set(input("enabled (optional)"),"1");input("Include count").click();set(input("count (optional)"),"0")')
  // Submit using the keyboard, then attempt a second click while the call is pending.
  await evaluate('btn("Call tool").focus()')
  assert(await evaluate('document.activeElement === btn("Call tool")'))
  await cdp('Input.dispatchKeyEvent', {type:'keyDown', key:'Enter', code:'Enter', text:'\r', unmodifiedText:'\r', windowsVirtualKeyCode:13})
  await cdp('Input.dispatchKeyEvent', {type:'keyUp', key:'Enter', code:'Enter', windowsVirtualKeyCode:13})
  assert(await evaluate('btn("Call tool").disabled || !!input("Whole result")'), 'Enter activated the focused tool button')
  await evaluate('if(btn("Call tool").disabled)btn("Call tool").click()')
  await wait('input("Whole result")?.checked')
  assert.equal(await evaluate('document.querySelector(".mcp-preview tbody tr").cells[2].textContent'), 'private | <em>notes</em>')
  assert.equal(await evaluate('document.querySelector(".mcp-preview em") === null'), true)
  await evaluate('input("title").click();input("status").click()')
  await wait('btn("Use this result") && !btn("Use this result").disabled')
  const rows = await evaluate('[...document.querySelectorAll(".mcp-preview tr")].map(row => [...row.cells].map(cell => cell.textContent))')
  assert.deepEqual(rows, [['title', 'status'], ['First', 'null'], ['Second', '']])
  assert.equal(await evaluate('document.querySelector(".mcp-preview h1").textContent'), 'tickets')
  assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'Form overflows viewport')
  assert(await evaluate('matchMedia("(prefers-color-scheme: ' + theme + ')").matches'))
  if (process.env.STUDIO_MCP_SCREENSHOTS) {
    await evaluate('input("Whole result").scrollIntoView({block:"center"})')
    const {data} = await cdp('Page.captureScreenshot')
    writeFileSync(join(process.env.STUDIO_MCP_SCREENSHOTS, name + '.png'), Buffer.from(data, 'base64'))
  }
  await click('Use this result')
  await click('Preview changes')
  await click('4. Import into wiki')
  await wait('btn("Inspect activity")')
  await click('Source library')
  await wait('[...document.querySelectorAll("tr")].some(r => r.innerText.includes(' + JSON.stringify(name) + '))')
  await evaluate('[...document.querySelectorAll("tr")].find(r => r.innerText.includes(' + JSON.stringify(name) + ')).querySelectorAll("button")[1].click()')
  await wait('btn("Call tool")')
  assert(await evaluate('!input("Include count").checked && !input("Include enabled").checked && !btn("Use this result")'))
  // A changed result shape reports the lost paths and requires a revised selection.
  await evaluate('input("Include mode").click();set(input("mode (optional)"),"2")')
  await click('Call tool')
  await wait('input("Use revised selection")')
  assert(await evaluate('btn("Use this result").disabled'))
  await evaluate('input("title").click();input("Use revised selection").click()')
  await click('Use this result')
  await wait('document.querySelector(".expected-pages")?.textContent.includes(' + JSON.stringify(name + '.md') + ')')
  await click('Source library')
  await wait('[...document.querySelectorAll("tr")].some(r => r.innerText.includes(' + JSON.stringify(name) + '))')
  await evaluate('[...document.querySelectorAll("tr")].find(r => r.innerText.includes(' + JSON.stringify(name) + ')).querySelectorAll("button")[1].click()')
  await wait('btn("Call tool")')
  await evaluate('input("Include mode").click();set(input("mode (optional)"),"5")')
  await click('Call tool')
  await click('All wikis')
  await click('A · Editable')
  await wait('document.querySelector("#wiki-nav") && !navigating')
  await click('Import')
  await wait('btn("Add source")')
  assert(!await evaluate('!!btn("Use this result")'))
  console.log('PASS: browser MCP import, fresh update arguments and pending-call navigation in', theme, width)
}
test().catch(error => {console.error(error);process.exitCode=1}).finally(() => child.kill())
