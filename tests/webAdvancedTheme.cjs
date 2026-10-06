const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const page = fs.readFileSync('public/index.md', 'utf8');
const start = page.indexOf('    function __refreshDarkMode() {');
const source = page.slice(start, page.indexOf('</script>', start));
const roots = ['advanced-shell','advanced-toolbar','advanced-completions','advanced-divider','advanced-dialog'];
const makeDiv = root => ({id:'',style:{},classList:{contains:()=>false},closest:selector=>root && selector.includes('.'+root) ? {} : null});
const advanced = roots.map(makeDiv), ordinary = makeDiv(null), classes = new Set();
const context = vm.createContext({
  document:{body:{classList:{contains:c=>classes.has(c),add:(...c)=>c.forEach(x=>classes.add(x)),remove:(...c)=>c.forEach(x=>classes.delete(x))}},querySelectorAll:selector=>selector==='div'?[...advanced,ordinary]:[],getElementById:()=>null},
  getComputedStyle:()=>({borderColor:'#ccc'})
});
vm.runInContext(source,context);
for (const dark of [true,false,true,false]) {
  context.__isDark=dark; context.__refreshDarkMode();
  assert.equal(classes.has('markdown-body-dark'),dark);
  assert.equal(ordinary.style.color,dark?'#e6e6e6':'#000000','Simple components still switch');
  advanced.forEach(div=>assert.deepEqual(div.style,{},'Advanced colors stay owned by CSS across refreshes'));
}
console.log('Theme refresh checks passed for light/dark transitions and all Advanced component roots.');
