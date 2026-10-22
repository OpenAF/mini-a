const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {el}=require('./webAdvancedFixture.cjs');
const source=fs.readFileSync('public/advanced.js','utf8');
const properties={},classes=new Set(),writes=[];
const context=vm.createContext({enabled:true,paneFocused:false,split:el('div'),focusControl:el('button'),splitSize:57,
  finishDrag(){},horizontalDivider:()=>false,dockPosition:()=> 'left',dockButtons:[],dockTrigger:null,followActivity(){},
  document:{body:{style:{setProperty:(k,v)=>properties[k]=v},dataset:{},classList:{toggle:(k,v)=>v?classes.add(k):classes.delete(k)}}},
  localStorage:{setItem:(k,v)=>writes.push([k,v])}
});
vm.runInContext(source.slice(source.indexOf('  function setPaneFocused('),source.indexOf("  try { const saved = Number(localStorage")),context);
vm.runInContext(source.slice(source.indexOf('  function applySplit('),source.indexOf('  function finishDrag(')),context);
context.setPaneFocused(true);assert.equal(context.split.hidden,true);assert.equal(context.focusControl.textContent,'Restore split');assert.ok(classes.has('advanced-pane-focused'));
context.setPaneFocused(false);assert.equal(context.split.hidden,false);assert.equal(context.focusControl.textContent,'Focus pane');assert.equal(context.splitSize,57);assert.equal(context.document.body.dataset.advancedDock,'left');assert.equal(properties['--advanced-size'],'57');assert.equal(writes.length,0,'temporary focus does not overwrite saved split');
context.enabled=false;context.setPaneFocused(false);assert.equal(context.split.hidden,true);
console.log('Pane focus: restores split size and docking without changing saved preferences.');
