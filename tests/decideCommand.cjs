const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const session = fs.readFileSync('mini-a-session.js', 'utf8');
const source = fs.readFileSync('public/advanced.js', 'utf8');
const all = node => [node, ...node.children.flatMap(all)];
function el(tag, text = '') {
  return {tag, textContent:text, children:[], hidden:false,
    get value() { return this._value ?? (tag === 'select' ? this.children[0]?.value || '' : ''); },
    set value(value) { this._value = value; },
    append(...children) { children.forEach(child => { child.parentNode=this; this.children.push(child); }); },
    replaceChildren(...children) { this.children=[]; this.append(...children); },
    remove() { this.parentNode.children.splice(this.parentNode.children.indexOf(this),1); },
    setAttribute(key,value) { this[key]=value; },
    querySelectorAll(selector) { return all(this).slice(1).filter(node => selector.split(',').includes(node.tag)); },
    reset() { for (const node of all(this)) if (['input','textarea'].includes(node.tag)) node.value=''; }
  };
}
let uuid='first', submitted=[];
const ctx=vm.createContext({el, input:text=>el('input'), button:(text,onclick)=>Object.assign(el('button',text),{onclick}),
  bridge:{uuid:()=>uuid}, resultGeneration:1, activeScreen:'decide', busy:false, snapshot:{closed:false}, screen:el('div'),
  TextEncoder, command:async text=>submitted.push(text), settingsRefresh:null
});
vm.runInContext(source.slice(source.indexOf('  function decisionScreen('),source.indexOf('  function actions(')),ctx);
ctx.decisionScreen();
const forms=all(ctx.screen).filter(n=>n.tag==='form'), guided=forms[0], structured=forms[1];
const field=(label,parent=guided)=>all(parent).find(n=>n['aria-label']===label);
const click=async text=>all(ctx.screen).find(n=>n.tag==='button' && n.textContent===text).onclick();
const submit=()=>guided.onsubmit({preventDefault(){}});
(async()=>{
  field('Shared scope / instructions').value='Only supplied evidence'; field('Evidence').value='Double charge';
  field('Question name').value='urgent'; field('Question instructions').value='Urgent?';
  submit(); assert.equal(submitted.length,0,'review does not call provider');
  await click('Submit decision');
  const request=JSON.parse(submitted[0].slice('/decide '.length));
  assert.equal(request.state.scope,'Only supplied evidence'); assert.equal(request.questions.urgent.type,'boolean');
  await click('Add question'); const rows=all(guided).filter(n=>n.tag==='fieldset');
  field('Question name',rows[1]).value='urgent'; field('Question instructions',rows[1]).value='Duplicate'; submit();
  assert.ok(all(guided).some(n=>n.textContent==='Question names must be nonempty and unique.'));
  field('Question name',rows[1]).value='team'; field('Question type',rows[1]).value='choice';
  field('Question type',rows[1]).onchange();
  field('Criteria: choice uses key = description per line; score uses one level per line',rows[1]).value='billing = Payments\ntech = Software';
  submit(); await click('Submit decision');
  assert.deepEqual(JSON.parse(submitted[1].slice(8)).questions.team.criteria,{billing:'Payments',tech:'Software'});
  field('Question type',rows[1]).value='score'; field('Question type',rows[1]).onchange();
  field('Criteria: choice uses key = description per line; score uses one level per line',rows[1]).value='Routine\nUrgent';
  submit(); await click('Submit decision'); assert.deepEqual(JSON.parse(submitted[2].slice(8)).questions.team.criteria,['Routine','Urgent']);
  guided.oninput(); const count=submitted.length; await click('Submit decision'); assert.equal(submitted.length,count,'edits invalidate review');
  ctx.busy=true; ctx.settingsRefresh(); assert.ok(guided.querySelectorAll('input,textarea,select,button').every(n=>n.disabled));
  field('Request containing state and questions',structured).value='(state: Evidence, questions: ())';
  await structured.onsubmit({preventDefault(){}}); assert.equal(submitted.length,count,'busy blocks submission');
  ctx.busy=false; ctx.settingsRefresh(); await structured.onsubmit({preventDefault(){}}); assert.match(submitted.at(-1),/^\/decide \(state:/);
  uuid='second'; await structured.onsubmit({preventDefault(){}}); assert.equal(submitted.length,count+1,'stale form cannot submit to another session');
  uuid='first'; await click('Cancel'); assert.ok(all(guided).some(n=>n.textContent==='Decision cancelled.'));
  // Exercise the real guided-console function with queued answers and validation.
  const decision=fs.readFileSync('mini-a-decision.js','utf8');
  const queue=[], output=[];
  const fixture=vm.createContext({__:undefined, MiniADecision:{error:code=>Object.assign(new Error(code),{code})},
    isMap:x=>x!==null && typeof x==='object' && !Array.isArray(x), isArray:Array.isArray,
    isString:x=>typeof x==='string', isDef:x=>x!==undefined, isUnDef:x=>x===undefined,
    stringify:JSON.stringify, af:{fromString2Bytes:x=>Buffer.from(x),fromJSSLON:JSON.parse},
    ask:()=>queue.shift(), askChoose:()=>queue.shift(), __miniANormalizeChoiceIndex:(value,max)=>Number.isInteger(value) && value>=0 && value<max ? value : -1, con:{readLinePrompt:()=>queue.shift()}, printTree:x=>({tree:x}), print:x=>output.push(x), printErr:x=>output.push(x),colorifyText:x=>x,hintColor:'',
    $o:(value,options)=>output.push({yaml:value,format:options.__format}), multiLinePrompt:'... '
  });
  vm.runInContext(decision.slice(decision.indexOf('MiniADecision.validateConsultation ='),decision.indexOf('MiniADecision.request =')),fixture);
  fixture.MiniADecision.validateConsultation({state:'Evidence',questions:{q:{type:'boolean',instructions:'Relevant?',criteria:{false:'Irrelevant',true:'Relevant'}}}});
  assert.throws(()=>fixture.MiniADecision.validateConsultation({state:'Evidence',questions:{q:{type:'boolean',instructions:'Relevant?',criteria:{yes:'Yes',no:'No'}}}}),e=>e.code==='LLM_DECISION_INVALID_REQUEST');
  vm.runInContext(session.slice(session.indexOf('  function composeDecision('),session.indexOf('  function runDecision(')),fixture);
  queue.push('scope','facts','urgent',0,'Urgent?',1,'urgent','team',1,'Which team?','billing','Payments','tech','Software',0,0,1);
  const composed=fixture.composeDecision(); assert.ok(output.some(x=>x?.yaml===composed && x.format==='cyaml'),'request preview uses colored YAML'); assert.equal(Object.keys(composed.questions).length,2); assert.ok(output.some(x=>String(x).includes('unique')));
  queue.push('scope','facts','q',0,'Question?',0,0); assert.equal(fixture.composeDecision(),undefined,'cancel at review');
  queue.push('scope','facts','q',3); assert.throws(()=>fixture.composeDecision(),e=>e.cancelled===true,'cancel from question type menu');
  queue.push('/cancel'); assert.throws(()=>fixture.composeDecision(),e=>e.cancelled===true,'cancel during input');
  queue.push('scope','"""','multiline','evidence','"""','q',2,'Rate','Low','High',0,0,1);
  assert.equal(fixture.composeDecision().state.evidence,'multiline\nevidence');
  queue.push('scope','"""','/cancel'); assert.throws(()=>fixture.composeDecision(),e=>e.cancelled===true,'cancel during multiline input');
  console.log('PASS /decide guided console and web forms: review, types, duplicate names, cancellation, busy guards and session isolation');
})().catch(error=>{console.error(error);process.exitCode=1;});
