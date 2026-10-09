const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '../backend/data/bundled/github');
const manifest = JSON.parse(fs.readFileSync(path.join(root, (process.argv.includes('--mocks') ? 'mocks408.json' : 'manifest.json')), 'utf8'));
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const katex = path.join(root, 'assets/math/js/katex');
const css = pathToFileURL(path.join(katex, 'katex.min.css')).href;
const js = pathToFileURL(path.join(katex, 'katex.min.js')).href;
const auto = pathToFileURL(path.join(katex, 'auto-render.min.js')).href;
function markdown(text, kind) {
  const images=[];
  text=String(text).replace(/<summary[^>]*>[\s\S]*?<\/summary>/gi,'').replace(/<\/?(?:details|p|div|br)[^>]*>/gi,'\n').replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_, ref) => {
    const decoded=decodeURIComponent(ref.split('#')[0]);
    const file=path.resolve(root,'assets',kind,decoded);
    const allowed=path.resolve(root,'assets',kind)+path.sep;
    if(!file.startsWith(allowed)||!fs.existsSync(file)) throw Error('Missing image '+ref);
    images.push('<img src="'+pathToFileURL(file).href+'">');
    return 'IMAGEPLACEHOLDER'+(images.length-1)+'END';
  });
  if (/<img\b/i.test(text)) throw Error('Unresolved HTML image');
  return escape(text).replace(/IMAGEPLACEHOLDER(\d+)END/g,(_,i)=>images[Number(i)]).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
}
app.whenReady().then(async()=>{
 const repairs = process.argv.includes('--repair') ? new Set(JSON.parse(fs.readFileSync(path.join(__dirname,'out/github-format-repair.json'),'utf8'))) : null;
 const jobs=manifest.questions.filter(q=>q.render && (!repairs || repairs.has(q.id)));let cursor=0,done=0;
 async function worker(index){
  const win=new BrowserWindow({show:false,width:1050,height:900,webPreferences:{sandbox:true,contextIsolation:true}});
  try {
   while(cursor<jobs.length){
    const q=jobs[cursor++],kind=q.id.split('-')[1];
    for(const variant of ['question','analysis']){
     const output=path.join(root,q.id+'-'+variant+(repairs?'-repaired':'')+'.png');
     if(fs.existsSync(output))continue;
     const content=variant==='question' ? markdown(q.stem_markdown,kind)+q.options.map(o=>'<p>'+o.key+'. '+markdown(o.text,kind)+'</p>').join('') : '<b>参考答案</b><p>'+markdown(q.answer_markdown,kind)+'</p><b>解析与来源</b><p>'+markdown(q.analysis_markdown,kind)+'</p>';
     const doc='<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="'+css+'"><style>body{margin:0;width:960px;padding:26px;font:21px/1.7 "Microsoft YaHei",sans-serif;color:#202020;background:white;overflow-wrap:anywhere}img{max-width:920px;height:auto;display:block;margin:12px auto}.katex-display{overflow:visible}.katex{font-size:1.05em}p{margin:12px 0}</style><main>'+content+'</main><script src="'+js+'"></script><script src="'+auto+'"></script>';
     const input=path.join(root,'render-'+index+'.html');fs.writeFileSync(input,doc);
     await win.loadFile(input);
     const height=await win.webContents.executeJavaScript('(async()=>{renderMathInElement(document.body,{delimiters:[{left:"$$",right:"$$",display:true},{left:"$",right:"$",display:false}],throwOnError:false,trust:false});await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));return Math.ceil(document.body.scrollHeight)})()');
     if(height>28000)throw Error('Preview too tall '+q.id);
     win.setContentSize(1050,Math.max(200,height));
     await new Promise(resolve=>setTimeout(resolve,30));
     fs.writeFileSync(output,(await win.webContents.capturePage({x:0,y:0,width:1012,height})).toPNG());
    }
    done++;if(done%100===0)console.log(JSON.stringify({rendered:done,total:jobs.length}));
   }
  } finally {win.destroy();}
 }
 try{await Promise.all([0,1,2,3].map(worker));console.log(JSON.stringify({complete:true,questions:done}));app.exit(0);}catch(e){console.error(e);app.exit(1);}
});
