import { app, BrowserWindow, session, screen } from 'electron';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const output=join(import.meta.dirname,'out/timer-smoke');mkdirSync(output,{recursive:true});
const profile=mkdtempSync(join(output,'profile-'));app.setPath('userData',profile);
const now=Date.now();
const state={schemaVersion:1,revision:0,migrated:true,completedRounds:0,preferences:{durations:{focus:25,shortBreak:5,longBreak:15},sound:true,volume:.1},session:{id:'smoke-session',mode:'focus',title:'整卷限时训练 · 暂停与超时验收',plannedMs:60000,status:'paused',startedAt:now-50000,checkpointAt:now,elapsedMs:50000,pausedMs:0,alerted:false,dismissed:false,resultHidden:false},history:[],recentRequests:[]};
writeFileSync(join(profile,'focus-timer.json'),JSON.stringify(state));
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://127.0.0.1:8000/*']},(details,callback)=>callback({redirectURL:details.url.replace(':8000',':8017')})));
await import('./out/main/main.js');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const js=(w,source)=>w.webContents.executeJavaScript(source);
async function waitFor(check,label){const end=Date.now()+16000;while(Date.now()<end){const value=await check();if(value)return value;await delay(100);}throw Error('Timed out: '+label);}
async function ready(w,selector){await waitFor(()=>!w.webContents.isLoading(),'loaded');await waitFor(()=>js(w,'!!document.querySelector('+JSON.stringify(selector)+')'),selector);}
const click=async(w,text)=>js(w,'(()=>{const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==='+JSON.stringify(text)+');if(!b)throw Error("Button missing: '+text+'");b.click();})()');
async function capture(w,name){await delay(250);writeFileSync(join(output,name+'.png'),(await w.webContents.capturePage()).toPNG());}
function inside(w){const r=w.getBounds(),a=screen.getDisplayMatching(r).workArea;assert(r.x>=a.x-2&&r.y>=a.y-2&&r.x+r.width<=a.x+a.width+2&&r.y+r.height<=a.y+a.height+2,JSON.stringify({r,a}));}
const overlap=(a,b)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
async function run(){try{
 await app.whenReady();
 const main=await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w.getSize()[0]>900),'main');await ready(main,'.home-pomodoro .timer-card[data-status=paused]');
 const timer=await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=timer')),'timer');await ready(timer,'.timer-card');
 await js(timer,'window.__rings=0;window.paperHelper.onTimerSound(x=>{if(x.play)window.__rings++});void 0;');
 assert.equal((await js(main,'window.paperHelper.getTimer()')).session.id,'smoke-session');
 await js(main,"document.querySelector('.home-pomodoro').scrollIntoView({block:'center'})");await capture(main,'home-paused');
 await js(main,"window.paperHelper.showAmbient('pet')");let pet=await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=pet')),'pet');await ready(pet,'.desktop-pet-surface');await waitFor(()=>timer.isVisible(),'timer visible');
 assert.equal(await js(timer,"getComputedStyle(document.documentElement).backgroundColor"),'rgba(0, 0, 0, 0)');
 assert((await js(pet,'window.paperHelper.getPetSettings()')).timerHeld);assert.equal(pet.getSize()[0],220);
 await capture(timer,'pet-paused');await capture(pet,'pet');
 const initial=pet.getPosition();await delay(350);assert.deepEqual(pet.getPosition(),initial);
 const a=screen.getDisplayMatching(pet.getBounds()).workArea;
 for(const [x,y] of [[a.x,a.y],[a.x+a.width-1,a.y],[a.x,a.y+a.height-1],[a.x+a.width-1,a.y+a.height-1]]){await js(pet,'window.paperHelper.dragPetTo('+x+','+y+')');await delay(120);inside(timer);assert.equal(pet.getSize()[0],220);assert(!overlap(pet.getBounds(),timer.getBounds()));}
 for(const display of screen.getAllDisplays()){
  const area=display.workArea;await js(pet,'window.paperHelper.dragPetTo('+(area.x+150)+','+(area.y+240)+')');await delay(300);inside(timer);assert.equal(screen.getDisplayMatching(pet.getBounds()).id,display.id);assert.equal(pet.getSize()[0],220);
  const previous=pet.getPosition();await js(timer,'window.paperHelper.dragTimerBy(35,25)');await delay(150);assert(Math.abs(pet.getPosition()[0]-previous[0]-35)<=2);assert(!overlap(pet.getBounds(),timer.getBounds()));await capture(timer,'display-'+display.scaleFactor+'-timer');
 }
 await js(pet,'window.paperHelper.dragPetTo('+(a.x+300)+','+(a.y+400)+')');await delay(200);
 await js(pet,'window.paperHelper.dragPetTo('+(a.x+a.width-240)+','+(a.y+a.height-240)+')');await delay(200);
 await js(pet,'window.paperHelper.showPetTodos()');const todos=await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=todos')),'todos');await ready(todos,'.pet-todo-panel');await delay(500);assert(!overlap(timer.getBounds(),todos.getBounds()));assert(!overlap(pet.getBounds(),todos.getBounds()));await capture(todos,'todos');
 await js(todos,'window.paperHelper.hidePetTodos()');
 await js(main,"window.paperHelper.showAmbient('ball')");pet=await waitFor(()=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('surface=ball')),'ball');await ready(pet,'.is-ball');assert.equal(pet.getSize()[0],92);inside(timer);await capture(timer,'ball-paused');
 await js(timer,"document.querySelector('[aria-label=展开计时控制]').click()");await click(timer,'继续');await waitFor(()=>js(timer,"document.querySelector('.timer-card').dataset.status==='running'"),'resumed');
 await js(timer,"document.querySelector('[aria-label=收起计时面板]').click()");await capture(timer,'ball-running');
 const focusedBefore=BrowserWindow.getFocusedWindow()?.id;
 await waitFor(()=>js(timer,"document.querySelector('.timer-card').dataset.status==='overtime'"),'deadline');
 assert.equal(BrowserWindow.getFocusedWindow()?.id,focusedBefore,'alarm must not steal focus');
 assert.equal(await js(timer,'window.__rings'),1);await capture(timer,'ball-overtime');
 const before=(await js(main,'window.paperHelper.getTimer()')).session.elapsedMs;
 await click(timer,'收起提醒');await delay(1300);
 assert((await js(main,'window.paperHelper.getTimer()')).session.elapsedMs>before+900);
 assert.equal(await js(timer,'window.__rings'),1);assert.equal(await js(timer,"[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='暂停')"),false);
 await capture(timer,'ball-overtime-collapsed');await click(timer,'结束本次');await waitFor(()=>js(timer,"document.querySelector('.timer-card').dataset.status==='ended'"),'ended');await capture(timer,'result');
 assert.equal((await js(main,'window.paperHelper.getTimer()')).history.length,1);
 await js(timer,"document.querySelector('[aria-label=收起计时面板]').click()");await waitFor(()=>!timer.isVisible(),'hide result');assert.equal((await js(pet,'window.paperHelper.getPetSettings()')).timerHeld,false);
 await js(pet,"document.querySelector('main').click()");await waitFor(()=>main.isVisible(),'ball opens main');
 const paper=JSON.parse(readFileSync(join(output,'fixture.json'),'utf8'));
 await js(main,'window.dispatchEvent(new CustomEvent("paper-helper:timer-paper",{detail:{id:'+JSON.stringify(paper.paper_id)+'}}))');await ready(main,'.paper-timer');
 await click(main,'整套 Word（ZIP）');await waitFor(()=>js(main,"!!document.querySelector('.notice a[download]')"),'package ready');
 const packageUrl=await js(main,"document.querySelector('.notice a[download]').href");assert((await (await fetch(packageUrl.replace(':8000',':8017'))).arrayBuffer()).byteLength>1000);
 await click(main,'准备计时');const expectedMinutes=paper.duration_minutes??75;assert.equal(await js(main,"document.querySelector('[aria-label=计时时长]').value"),String(expectedMinutes));
 await capture(main,'paper-package-and-timer');await click(main,'开始计时');await ready(main,'.home-pomodoro .timer-card[data-status=running]');
 const linked=await js(main,'window.paperHelper.getTimer()');assert(linked.session.paper.version.startsWith('pack-'));assert.equal(linked.session.plannedMs,expectedMinutes*60000);assert.equal(linked.preferences.durations.focus,25);
 await click(main,'提前结束');await ready(main,'.timer-confirm');assert.equal((await js(main,'window.paperHelper.getTimer()')).session.status,'running');await click(main,'确认结束');
 await waitFor(async()=>(await js(main,'window.paperHelper.getTimer()')).session.status==='ended','early ended');
 assert.equal((await js(main,'window.paperHelper.getTimer()')).completedRounds,1);
 main.webContents.reload();await ready(main,'.home-pomodoro .timer-card[data-status=ended]');assert.equal((await js(main,'window.paperHelper.getTimer()')).history.length,2);
 assert.equal(await js(timer,'window.__rings'),1);assert.equal(await js(timer,"document.querySelector('.timer-error')?.textContent??''"),'');
 const audioCheck=await js(timer,"new Promise(resolve=>{const a=new Audio(new URL('./assets/timer-alarm.wav',document.baseURI));a.onloadedmetadata=()=>resolve(a.duration);a.onerror=()=>resolve(-1)})");assert.equal(audioCheck,3);
 console.log('PASS desktop: shared state, pause, pet/ball, all four corners, todo avoidance, single reminder without focus theft, overtime, end, roam restore, real ZIP, paper duration/version, reload, local sound asset');
 console.log('Screenshots: '+output);console.log('Displays: '+JSON.stringify(screen.getAllDisplays().map(d=>({scale:d.scaleFactor,workArea:d.workArea}))));
 app.quit();
}catch(error){console.error(error);writeFileSync(join(output,'failure.txt'),String(error.stack??error));app.exit(1);}}
void run();
