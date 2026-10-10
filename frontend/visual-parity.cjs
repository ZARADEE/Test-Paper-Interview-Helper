// Compare every state with the fixed upstream source archive, including simulator output.
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const assert=require('node:assert/strict');
const ts=require('typescript');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const archive=process.argv[2]||path.join(__dirname,'out/408-mock-source.zip');
const source=JSON.parse(execFileSync('python',['-c',"import sys,json,zipfile; z=zipfile.ZipFile(sys.argv[1]); names=['kinds-a.tsx','kinds-b.tsx','pages-sim.ts']; print(json.dumps({name:z.read(next(p for p in z.namelist() if p.endswith('/visuals/'+name))).decode('utf-8') for name in names}))",archive],{encoding:'utf8'}));
const current=Object.fromEntries(Object.keys(source).map(name=>[name,fs.readFileSync(path.join(__dirname,'src/components/visuals',name),'utf8')]));
function modules(files){
 const cache={};
 function load(name){if(cache[name])return cache[name].exports;const module={exports:{}};cache[name]=module;const compiled=ts.transpileModule(files[name],{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2020}}).outputText;new Function('require','module','exports',compiled)(id=>id.endsWith('/utils')?{cn:(...args)=>args.filter(Boolean).join(' ')}:id.endsWith('/pages-sim')?load('pages-sim.ts'):require(id),module,module.exports);return module.exports;}
 return {...load('kinds-a.tsx'),...load('kinds-b.tsx'),...load('pages-sim.ts')};
}
const before=modules(source),after=modules(current);
function normalize(html){const ids=[...html.matchAll(/<marker id="([^"]+)"/g)].map(x=>x[1]);ids.forEach((id,i)=>html=html.split(id).join('marker-'+i));return html;}
function element(lib,s,step){switch(s.kind){case 'sort':return React.createElement(lib.SortVisual,{frames:s.frames,step});case 'tree':return React.createElement(lib.TreeVisual,{steps:s.steps,step});case 'graph':return React.createElement(lib.GraphVisual,{spec:s,step});case 'pages':return React.createElement(lib.PagesVisual,{spec:s,step});case 'cwnd':return React.createElement(lib.CwndVisual,{points:s.points,step});case 'pipeline':return React.createElement(lib.PipelineVisual,{spec:s,step});case 'seq':return React.createElement(lib.SeqVisual,{spec:s,step});case 'flow':return React.createElement(lib.FlowVisual,{spec:s});default:throw Error(s.kind);}}
const questions=require('../backend/data/bundled/github/mocks408.json').questions;
let diagrams=0,states=0;const kinds={};
for(const q of questions){const s=q.origin?.visual;if(!s)continue;diagrams++;kinds[s.kind]=(kinds[s.kind]||0)+1;const count=s.kind==='flow'?1:s.kind==='sort'?s.frames.length:s.kind==='pages'?s.accesses.length:s.kind==='cwnd'?s.points.length:s.kind==='pipeline'?s.instrs.length:s.kind==='seq'?s.messages.length:s.steps.length;if(s.kind==='pages')assert.deepEqual(after.simulatePages(s),before.simulatePages(s),q.id);for(let step=0;step<count;step++){assert.equal(normalize(renderToStaticMarkup(element(after,s,step))),normalize(renderToStaticMarkup(element(before,s,step))),q.id+' step '+step);states++;}}
const accesses='7 0 1 2 0 3 0 4 2 3 0 3 2'.split(' ');
for(const [algo,expected] of [['FIFO',10],['LRU',9],['OPT',7]]){const sequence=after.simulatePages({kind:'pages',title:'Known trace',algo,frames:3,accesses});assert.equal(sequence.filter(s=>!s.hit).length,expected,algo);}
console.log(JSON.stringify({status:'passed',diagrams,states,kinds,upstream:'d1f4bb80074a48c66791d3d5a4d6d716b06c1b51'}));
