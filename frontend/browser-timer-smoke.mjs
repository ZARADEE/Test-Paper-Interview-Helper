import {app,BrowserWindow,session} from 'electron';
import {mkdirSync,mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const output=join(import.meta.dirname,'out/timer-smoke');mkdirSync(output,{recursive:true});
app.setPath('userData',mkdtempSync(join(output,'browser-')));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const js=(w,s)=>w.webContents.executeJavaScript(s);
async function waitFor(check,label){for(let i=0;i<100;i++){if(await check())return;await delay(100);}throw Error('Timeout: '+label);}
async function create(){const w=new BrowserWindow({width:1200,height:900,show:false,webPreferences:{contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});await w.loadFile(join(import.meta.dirname,'out/renderer/index.html'));await waitFor(()=>js(w,'!!document.querySelector(".home-pomodoro .timer-card")'),'timer UI');return w;}
const click=(w,name)=>js(w,'(()=>{const b=[...document.querySelectorAll(".home-pomodoro button")].find(b=>b.textContent.trim()==='+JSON.stringify(name)+');if(!b)throw Error("Missing button");b.click()})()');
app.whenReady().then(async()=>{
 try{
 session.defaultSession.webRequest.onBeforeRequest({urls:['http://127.0.0.1:8000/*']},(d,c)=>c({redirectURL:d.url.replace(':8000',':8017')}));
 const first=await create();assert.equal(await js(first,'typeof navigator.locks.request'),'function');
 const now=Date.now(),state={schemaVersion:1,revision:10,migrated:true,completedRounds:0,preferences:{durations:{focus:25,shortBreak:5,longBreak:15},sound:true,volume:.1},session:{id:'browser-round',mode:'focus',title:'多窗口同步',plannedMs:60000,status:'paused',startedAt:now-59000,checkpointAt:now,elapsedMs:59000,pausedMs:0,alerted:false,dismissed:false,resultHidden:false},history:[],recentRequests:[]};
 await js(first,'navigator.locks.request("paper-helper.timer.v1",()=>{localStorage.setItem("paper-helper.timer.v1",'+JSON.stringify(JSON.stringify(state))+')})');
 const second=await create();
 for(const w of [first,second]){await js(w,'window.__plays=0;Audio.prototype.play=function(){window.__plays++;return Promise.resolve()};void 0;');await waitFor(()=>js(w,'document.querySelector(".home-pomodoro .timer-card").dataset.status==="paused"'),'paused restored');}
 await click(first,'继续');await waitFor(()=>js(second,'document.querySelector(".home-pomodoro .timer-card").dataset.status==="overtime"'),'shared overtime');await delay(1200);
 assert.equal(await js(first,'window.__plays')+await js(second,'window.__plays'),1,'only one tab rings');
 await click(second,'收起提醒');const before=await js(first,'JSON.parse(localStorage.getItem("paper-helper.timer.v1")).session.elapsedMs');await delay(1000);assert(await js(second,'JSON.parse(localStorage.getItem("paper-helper.timer.v1")).session.elapsedMs')>before+700);
 first.destroy();await click(second,'结束本次');await waitFor(()=>js(second,'document.querySelector(".home-pomodoro .timer-card").dataset.status==="ended"'),'owner closes and other ends');
 const saved=await js(second,'JSON.parse(localStorage.getItem("paper-helper.timer.v1"))');assert.equal(saved.history.length,1);assert.equal(saved.completedRounds,1);
 await second.loadFile(join(import.meta.dirname,'out/renderer/index.html'));await waitFor(()=>js(second,'document.querySelector(".home-pomodoro .timer-card")?.dataset.status==="ended"'),'reload result');
 const third=await create();
 await js(second,'window.__plays=0;window.__pauses=0;Audio.prototype.play=function(){window.__plays++;return Promise.resolve()};Audio.prototype.pause=function(){window.__pauses++};void 0;');
 await click(second,'试听');const previewPauses=await js(second,'window.__pauses');await delay(1100);assert.equal(await js(second,'window.__pauses'),previewPauses,'ended-session updates must not interrupt preview');
 await js(second,'document.querySelector(".home-pomodoro .timer-sound-settings input[type=checkbox]").click()');await waitFor(()=>js(second,'!JSON.parse(localStorage.getItem("paper-helper.timer.v1")).preferences.sound'),'sound disabled');
 await click(second,'试听');const mutedPauses=await js(second,'window.__pauses');await delay(1100);assert.equal(await js(second,'window.__pauses'),mutedPauses,'preview must work with reminders muted');assert.equal(await js(second,'window.__plays'),2);third.destroy();
 await js(second,'document.querySelector(".home-pomodoro").scrollIntoView({block:"center"})');writeFileSync(join(output,'browser-result.png'),(await second.webContents.capturePage()).toPNG());
 console.log('PASS browser: Web Locks, two windows, one alarm, dismiss keeps overtime, owner closure, end saves once, reload restores, preview survives ended/muted state synchronization');app.quit();
 }catch(e){console.error(e);app.exit(1);}
});
