import {app,BrowserWindow,session} from 'electron';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';

const output=join(import.meta.dirname,'out/politics-smoke');
mkdirSync(output,{recursive:true});
app.setPath('userData',mkdtempSync(join(output,'profile-')));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1400,height:1000,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false,offscreen:true}});
 const js=code=>win.webContents.executeJavaScript(code,true);
 const wait=async(code,label)=>{for(let i=0;i<100;i++){if(await js(code))return;await delay(100);}throw Error('Timeout: '+label);};
 const click=async(name)=>{await js('(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.getClientRects().length&&!b.disabled&&(b.textContent.trim()==='+JSON.stringify(name)+'||b.querySelector("span")?.textContent==='+JSON.stringify(name)+'));if(!b)throw Error("Missing button");b.click()})()');await delay(150);};
 const field=async(selector,value)=>{await js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');const p=e.tagName==="SELECT"?HTMLSelectElement.prototype:e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(e,'+JSON.stringify(value)+');e.dispatchEvent(new Event(e.tagName==="SELECT"?"change":"input",{bubbles:true}))})()');await delay(150);};
 const shot=async(name)=>{await delay(500);writeFileSync(join(output,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 try{
  session.defaultSession.webRequest.onBeforeRequest({urls:['http://127.0.0.1:8000/*']},(d,c)=>c({redirectURL:d.url.replace(':8000',':8017')}));
  await win.loadFile(join(import.meta.dirname,'out/renderer/index.html'));
  await wait('!!document.querySelector(".status-online")','backend ready');
  await click('小题狂练');await click('主观题练习');
  await wait('!!document.querySelector("[aria-label=主观题学科]")','subject filter');
  await field('[aria-label=主观题学科]','考研政治');
  await field('[aria-label=主观题题型]','solution');
  assert(await js('document.querySelector(".study-toolbar").textContent.includes("当前筛选 30 道")'));
  const data=JSON.parse(readFileSync(join(import.meta.dirname,'../backend/data/bundled/github/politics-solutions.json'),'utf8'));
  for(const chapter of [...new Set(data.questions.map(q=>q.chapter))]){
   await field('[aria-label=主观题知识点]',chapter);
   const expected=data.questions.filter(q=>q.chapter===chapter).length;
   assert(await js('document.querySelector(".study-toolbar").textContent.includes('+JSON.stringify('当前筛选 '+expected+' 道')+')'));
  }
  await field('[aria-label=主观题知识点]','哲学');
  await field('[aria-label=主观题题量]','1');
  await shot('politics-filters');
  await click('开始主观题练习');
  await wait('!!document.querySelector("[aria-label=主观题作答]")','question opens');
  assert.equal(await js('!!document.querySelector(".subjective-reference")'),false);
  assert.equal(await js('!!document.querySelector(".subjective-editor img[alt=原版题面]")'),false,'text-only questions must not request missing previews');
  assert(await js('document.querySelector(".subjective-editor").textContent.includes("年考研政治真题")'));
  await js('document.querySelector(".subjective-editor").scrollIntoView({block:"start",behavior:"instant"})');await shot('politics-question');
  await field('[aria-label=主观题作答]','实践是认识的基础，结合材料分析具体矛盾与认识的发展。');
  await click('提交作答并查看参考解');
  await wait('!!document.querySelector(".subjective-reference")','answer reveal');
  assert((await js('document.querySelector(".subjective-reference").textContent')).length>120);
  await js('document.querySelector(".subjective-reference").scrollIntoView({block:"start",behavior:"instant"})');await shot('politics-answer');
  console.log('PASS politics: 30 questions, five existing subcategories with exact counts, material rendering, answer hidden before submission, reference revealed after submission');
  app.quit();
 }catch(error){console.error(error);app.exit(1);}
});
