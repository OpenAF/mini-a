const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const page=fs.readFileSync('public/index.md','utf8');
const source=page.slice(page.indexOf('    // The Mermaid oPack'),page.indexOf('</script>',page.indexOf('    // The Mermaid oPack'))).replace("await import('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')","await importModule('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs')");
async function run(local) {
  const loaded=[],imports=[],configs=[],lib={initialize:config=>configs.push(config)};
  const context={URL,window:{},document:{baseURI:'http://localhost:12346/prefix/',body:{classList:{contains:()=>true}},createElement:()=>({}),head:{append(script){loaded.push(script.src);if(local){context.window.mermaid=lib;script.onload();}else script.onerror();}}},console:{warn(){}},importModule:async url=>{imports.push(url);return {default:lib};}};
  await vm.runInNewContext('(async()=>{'+source+'})()',context);
  assert.equal(loaded[0],'http://localhost:12346/prefix/js/mermaid.js');
  assert.equal(context.window.mermaid,lib);assert.equal(configs[0].securityLevel,'strict');assert.equal(configs[0].theme,'dark');
  assert.equal(imports.length,local?0:1);
}
(async()=>{await run(true);await run(false);console.log('Mermaid: local classic bundle, prefixed URL, CDN fallback and strict rendering passed.');})().catch(error=>{console.error(error);process.exitCode=1;});
