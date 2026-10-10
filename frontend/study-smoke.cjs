const {app,BrowserWindow}=require('electron');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
app.setPath('userData',path.join(app.getPath('temp'),'paper-study-ui-'+Date.now()));
const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{
 const win=new BrowserWindow({width:1450,height:1100,show:false,webPreferences:{sandbox:true,contextIsolation:true,backgroundThrottling:false,offscreen:true}});
 const errors=[];win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
 const ev=code=>win.webContents.executeJavaScript(code,true);
 const js=(fn,...args)=>ev('('+fn.toString()+')('+args.map(x=>JSON.stringify(x)).join(',')+')');
 const wait=async(code,...args)=>{for(let i=0;i<120;i++){if(await(typeof code==='function'?js(code,...args):ev(code)))return;await delay(100);}throw Error('Timeout: '+code);};
 const click=async text=>{assert(await js(t=>{const b=[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&!b.disabled&&(b.textContent.trim()===t||b.matches('.rail-button')&&b.querySelector('span')?.textContent===t));if(!b)return false;b.click();return true;},text),'Button: '+text);await delay(160);};
 const field=async(selector,value)=>{await js((s,v)=>{const e=document.querySelector(s);if(!e)throw Error('Missing field '+s);const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:e.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,v);e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true}));},selector,value);await delay(100);};
 const out=path.join(__dirname,'out/study-smoke');fs.mkdirSync(out,{recursive:true});
 const shot=async name=>{await delay(200);fs.writeFileSync(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());};
 const api=path=>js(p=>fetch('http://127.0.0.1:8017'+p).then(r=>r.json()),path);
 const mock=require('../backend/data/bundled/github/mocks408.json');
 const subjectId=mock.questions.find(q=>q.type==='solution'&&q.origin.visual).id;
 try{
  win.webContents.session.webRequest.onBeforeRequest({urls:['http://127.0.0.1:8000/*']},(details,callback)=>callback({redirectURL:details.url.replace(':8000/',':8017/')}));
  await win.loadURL('http://127.0.0.1:5181');const startingCalls=(await api('/__test/grader-calls')).calls;await wait("document.querySelector('.status-online')");await click('小题狂练');
  assert.equal(await ev("document.querySelector('.rail-button.is-active span').textContent"),'小题狂练');
  await click('主观题练习');await wait(()=>!!document.querySelector('[aria-label="使用 Agent 判题"]'));
  assert.equal(await js(()=>document.querySelector('[aria-label="使用 Agent 判题"]').checked),false);
  await js(()=>document.querySelector('[aria-label="使用 Agent 判题"]').click());await wait("document.querySelector('dialog[open]')");await click('取消');
  assert.equal(await js(()=>document.querySelector('[aria-label="使用 Agent 判题"]').checked),false);
  await click('配置 Agent');await wait("document.querySelector('dialog[open]')");
  await field('dialog input[type=url]','https://example.com/v1');await field('dialog input:not([type])','smoke-model');await field('dialog input[type=password]','smoke-only-not-a-real-key');await click('确认配置');
  assert.equal(await js(()=>document.querySelector('[aria-label="使用 Agent 判题"]').checked),false,'Configuration alone must not enable grading');
  const sid=await js(id=>fetch('http://127.0.0.1:8017/api/subjective/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question_ids:[id],count:1})}).then(r=>r.json()).then(s=>{localStorage.setItem('paper-helper.subjective.last.v1',JSON.stringify({id:s.id,index:0}));return s.id;}),subjectId);
  await win.reload();await delay(650);await click('小题狂练');await click('主观题练习');await wait(()=>!!document.querySelector('[aria-label="主观题作答"]'));
  const draft='先明确状态与初始条件。\n每次操作更新状态，再检查边界。公式 $x^2$。';
  await field('[aria-label="主观题作答"]',draft);await wait("document.querySelector('.subjective-editor').textContent.includes('草稿已保存')");
  await click('预览作答与公式');await wait("document.querySelector('.subjective-editor .katex')");await shot('subjective-draft');
  await win.reload();await delay(500);await click('小题狂练');await click('主观题练习');await wait(()=>!!document.querySelector('[aria-label="主观题作答"]'));
  assert.equal(await js(()=>document.querySelector('[aria-label="主观题作答"]').value),draft);
  assert.equal((await api('/__test/grader-calls')).calls,startingCalls);
  await click('提交作答并查看参考解');await wait("document.querySelector('.subjective-reference')");
  assert.equal(await js(()=>document.querySelector('[aria-label="主观题作答"]').readOnly),true);
  assert.equal(await js(()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='请求 Agent 判题').disabled),true);
  await js(()=>document.querySelector('[aria-label="使用 Agent 判题"]').click());await wait("document.querySelector('dialog[open]')");
  await field('dialog input[type=url]','https://example.com/v1');await field('dialog input:not([type])','smoke-model');await field('dialog input[type=password]','smoke-only-not-a-real-key');await click('确认配置');
  assert.equal((await api('/__test/grader-calls')).calls,startingCalls);
  assert.equal(await ev("JSON.stringify(localStorage).includes('smoke-only-not-a-real-key')"),false);
  await click('请求 Agent 判题');await wait("document.querySelector('.agent-suggestion')");assert.equal((await api('/__test/grader-calls')).calls,startingCalls+1);
  assert.equal((await api('/api/subjective/sessions/'+sid)).items[0].verdict,null);
  await click('确认采用本次建议');await wait("document.querySelector('.subjective-grade').textContent.includes('用户确认 Agent 建议')");
  await field('[aria-label="自评完成情况"]','correct');await click('保存自评 / 改判');await wait("document.querySelector('.subjective-grade').textContent.includes('已确认：正确')");
  assert.equal((await api('/api/subjective/sessions/'+sid)).items[0].events.length,3);await js(()=>document.querySelector('.subjective-grade').scrollIntoView());await shot('subjective-grading');
  const rapidId=await js(ids=>fetch('http://127.0.0.1:8017/api/subjective/sessions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question_ids:ids,count:2})}).then(r=>r.json()).then(s=>{localStorage.setItem('paper-helper.subjective.last.v1',JSON.stringify({id:s.id,index:0}));return s.id;}),mock.questions.filter(q=>q.type==='solution').slice(0,2).map(q=>q.id));
  await win.reload();await delay(500);await click('小题狂练');await click('主观题练习');await wait(()=>!!document.querySelector('[aria-label="主观题作答"]'));
  await field('[aria-label="主观题作答"]','第一版快速切题');await js(()=>document.querySelectorAll('.subjective-answer-sheet button')[1].click());await delay(40);await js(()=>document.querySelectorAll('.subjective-answer-sheet button')[0].click());await delay(40);
  assert.equal(await js(()=>document.querySelector('[aria-label="主观题作答"]').value),'第一版快速切题');
  await field('[aria-label="主观题作答"]','第二版最终草稿');await wait("document.querySelector('.subjective-editor').textContent.includes('草稿已保存')");
  assert.equal((await api('/api/subjective/sessions/'+rapidId)).items[0].answer,'第二版最终草稿');
  assert.equal(await js(()=>!!document.querySelector('.subjective-editor [role=alert]')),false);
  await click('图解浏览');await wait("document.querySelector('.study-reader-list>button')");const listing=await api('/api/study/diagrams?page_size=200');assert.equal(listing.total,125);
  let checked=0;const checkedIds=new Set();
  for(const kind of ['sort','tree','graph','pages','cwnd','pipeline','seq','flow']){
   await field('[aria-label="图解类型"]',kind);await wait("document.querySelector('.study-reader-list>button') && !document.querySelector('.study-library>[role=status]')");
   let count=await ev("document.querySelectorAll('.study-reader-list>button').length");
   for(let page=1;;page++){
    for(let i=0;i<count;i++){
     const expected=listing.items.filter(d=>d.kind===kind)[(page-1)*24+i];
     await js(n=>document.querySelectorAll('.study-reader-list>button')[n].click(),i);await wait(id=>document.querySelector('.study-question-detail')?.dataset.questionId===id,expected.id);
     assert.equal(await ev("document.querySelector('.study-reader-content [data-visual]').dataset.visual"),kind);checkedIds.add(expected.id);
     assert.equal(await ev("document.querySelector('.study-reader-content').textContent.includes('图解数据无法显示')"),false);
     if(await ev("!!document.querySelector('.study-reader-content .visual-controls')")){await click('末步');assert((await ev("document.querySelector('.visual-note').textContent")).includes('步骤'));await click('首步');assert((await ev("document.querySelector('.visual-note').textContent")).includes('步骤 1/'));}
     checked++;if(i===0&&page===1){await js(()=>document.querySelector('.study-reader-content').scrollIntoView());await shot('diagram-'+kind);}
    }
    const next=await js(()=>{const b=[...document.querySelectorAll('.study-reader-list button')].find(b=>b.textContent==='下一页');return b&&!b.disabled;});
    if(!next)break;await click('下一页');await wait("!document.querySelector('.study-library>[role=status]')");count=await ev("document.querySelectorAll('.study-reader-list>button').length");
   }
  }
  assert.equal(checked,125);assert.equal(checkedIds.size,125);
  await click('知识点阅读');await wait("document.querySelector('.study-reader-list>button')");await field('[aria-label="搜索知识点"]','页面');await wait("document.querySelector('.study-reader-list>button')");await ev("document.querySelector('.study-reader-list>button').click()");await wait("document.querySelector('.study-reader-content h2')");await shot('knowledge-reader');
  if(await js(()=>!![...document.querySelectorAll('button')].find(b=>b.textContent==='查看完整讲解'))){await click('查看完整讲解');await wait("document.querySelector('.study-question-detail')");}
  await click('图解浏览');await wait("document.querySelector('.study-reader-list>button')");await field('[aria-label="图解类型"]','pages');await wait("!document.querySelector('.study-library>[role=status]')");await ev("document.querySelector('.study-reader-list>button').click()");await wait('document.querySelector(\'[data-visual="pages"]\')');
  await click('播放');await delay(1750);assert(!(await ev("document.querySelector('.visual-note').textContent")).includes('步骤 1/'));await click('暂停');
  win.setSize(390,844);await delay(500);await shot('mobile-diagram');const overflow=await ev('({width:innerWidth,body:document.body.scrollWidth})');assert(overflow.body<=overflow.width+1,JSON.stringify(overflow));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({status:'passed',diagrams:checked,rapidDraftSwitch:true,graderCalls:(await api('/__test/grader-calls')).calls-startingCalls,screenshots:out,errors}));
 }catch(error){await shot('failure').catch(()=>{});console.error(error);console.error('Renderer errors:',errors);win.destroy();app.exit(1);return;}
 win.destroy();app.quit();
});
