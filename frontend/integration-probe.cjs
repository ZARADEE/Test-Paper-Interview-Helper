const { app, BrowserWindow } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(app.getPath('temp'), `paper-probe-${Date.now()}`));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false,width:1440,height:1000,webPreferences:{sandbox:true}});
  const errors=[];
  win.webContents.on('console-message', (_,level,message)=> { if(level>=3) errors.push(message); });
  const run = code => win.webContents.executeJavaScript(code,true);
  try {
    await win.loadURL('http://127.0.0.1:5173'); await sleep(2000);
    for(const label of ['试卷模板','考研组卷','小题狂练','首页']) {
      await run(`Array.from(document.querySelectorAll('.rail-button')).find(b=>b.textContent.includes(${JSON.stringify(label)}))?.click()`); await sleep(900);
      console.log(JSON.stringify({label,root:await run(`document.getElementById('root').innerText.slice(0,180)`),errors}));
    }
    await run(`Array.from(document.querySelectorAll('.rail-button')).find(b=>b.textContent.includes('小题狂练')).click()`); await sleep(300);
    await run(`document.querySelector('.knowledge-tree button')?.click()`); await sleep(600);
    console.log(JSON.stringify({step:'knowledge card',root:await run(`document.getElementById('root').innerText.slice(0,100)`),errors}));
    await win.reload(); await sleep(1500);
    await run(`Array.from(document.querySelectorAll('.rail-button')).find(b=>b.textContent.includes('试卷模板')).click()`); await sleep(500);
    await run(`document.querySelector('.agent-toggle input')?.click()`); await sleep(400);
    console.log(JSON.stringify({step:'agent',dialog:await run(`Boolean(document.querySelector('dialog[open]'))`),errors}));
    await run(`document.querySelector('dialog button[type=button]').click()`);
    const count = await run(`document.querySelectorAll('.template-list-item').length`);
    for(let i=0;i<count;i++){
      await run(`document.querySelectorAll('.template-list-item')[${i}].click()`); await sleep(100);
      if(!await run(`Boolean(document.querySelector('.template-paper'))`)) throw Error('Template render failed: '+i);
    }
    await run(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='试题导入').click()`); await sleep(500);
    console.log(JSON.stringify({step:'all templates and import',count,hasWorkspace:await run(`document.querySelector('.workspace').innerText.length>100`),errors}));
  } catch(e) {console.error(e);}
  finally {win.destroy();app.exit(errors.length?1:0);}
});
