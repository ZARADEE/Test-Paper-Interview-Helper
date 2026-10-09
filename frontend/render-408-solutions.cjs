const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');const path=require('node:path');const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'../backend/data/bundled/github');
const staging=path.join(__dirname,'out/408-solutions');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'solutions408.json'),'utf8'));
const css=pathToFileURL(path.join(root,'assets/math/js/katex/katex.min.css')).href;
app.whenReady().then(async()=>{
 const win=new BrowserWindow({show:false,width:1100,height:900,webPreferences:{sandbox:true,contextIsolation:true}});
 try{
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_,callback)=>callback({cancel:true}));
  let count=0;
  for(const q of manifest.questions){
   for(const kind of ['question','analysis']){
    const raw=fs.readFileSync(path.join(staging,q.id+'-'+kind+'.html'),'utf8');
    await win.loadURL('about:blank');
    const clean=await win.webContents.executeJavaScript('(()=>{const doc=new DOMParser().parseFromString('+JSON.stringify(raw)+',"text/html");doc.querySelectorAll("script,iframe,object,embed,link,meta,style,title").forEach(n=>n.remove());doc.querySelectorAll("*").forEach(n=>{for(const a of [...n.attributes]){if(a.name.startsWith("on")||a.name==="content"||a.name==="srcdoc")n.removeAttribute(a.name);}if(n.hasAttribute("href"))n.removeAttribute("href");});return doc.body.innerHTML;})()');
    const html='<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src file: \'unsafe-inline\'; font-src file:; script-src \'none\'"><link rel="stylesheet" href="'+css+'"><style>body{margin:0;padding:28px;width:984px;background:white;color:#222;font:20px/1.65 "Microsoft YaHei",sans-serif;overflow-wrap:anywhere}p{margin:10px 0}img,svg{max-width:950px;height:auto}table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #444;padding:6px}pre{white-space:pre-wrap;background:#f8f8f8;padding:12px;font:17px/1.5 Consolas,monospace}.katex{font-size:1.08em}.svg-container{height:auto!important}.svg-wrapper{overflow:visible}h1,h2{font-size:22px}</style><h2>'+q.origin.year+' ? 408 ? '+q.origin.number+' ? ? '+(kind==='question'?'?????':'????')+'</h2>'+clean;
    const input=path.join(staging,'render.html');fs.writeFileSync(input,html);await win.loadFile(input);
    const h=await win.webContents.executeJavaScript('(async()=>{await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));return Math.ceil(document.body.scrollHeight)})()');
    if(h>26000)throw Error('Too tall '+q.id);
    win.setContentSize(1100,Math.max(h,200));await new Promise(r=>setTimeout(r,35));
    fs.writeFileSync(path.join(staging,q.id+'-'+kind+'.png'),(await win.webContents.capturePage({x:0,y:0,width:1040,height:h})).toPNG());
   }
   if(++count%20===0)console.log('Rendered',count);
  }
  win.destroy();app.exit(0);
 }catch(e){console.error(e);app.exit(1);}
});
