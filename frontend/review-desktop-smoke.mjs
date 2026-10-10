import { app, BrowserWindow, session } from "electron";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

app.setPath("userData",mkdtempSync(join(tmpdir(),"review-desktop-")));
process.env.ELECTRON_RENDERER_URL="http://127.0.0.1:5181";
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:["http://127.0.0.1:8000/*"]},(details,callback)=>callback({redirectURL:details.url.replace(":8000/",":8017/")})));
await import("./out/main/main.js");
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const js=(window,code)=>Promise.race([window.webContents.executeJavaScript(code,true),delay(8000).then(()=>{throw Error("Renderer timeout: "+code);})]);
async function wait(check){for(let n=0;n<150;n++){const value=await check();if(value)return value;await delay(100);}throw Error("Desktop navigation timeout");}
async function run(){
try{
 await app.whenReady();
 const main=await wait(()=>BrowserWindow.getAllWindows().find(w=>w.getSize()[0]>900));
 console.log("main created");
 await wait(async()=>!main.webContents.isLoading()&&await js(main,"!!document.querySelector('.status-online')"));
 await js(main,"window.paperHelper.showAmbient('pet')");
 console.log("pet requested");
 const pet=await wait(()=>BrowserWindow.getAllWindows().find(w=>w!==main&&w.isVisible()));
 await wait(()=>!pet.webContents.isLoading());
 await js(pet,"window.paperHelper.showPetTodos()");
 console.log("todo requested");
 const todo=await wait(()=>BrowserWindow.getAllWindows().find(w=>w!==main&&w!==pet));
 await wait(async()=>!todo.webContents.isLoading()&&await js(todo,"!!document.querySelector('.review-todo button')"));
 await js(todo,"document.querySelector('.review-todo button').click()");
 console.log("review requested");
 await wait(async()=>main.isVisible()&&await js(main,"document.querySelector('.rail-button.is-active span')?.textContent==='小题狂练' && !!document.querySelector('.review-queue')"));
 assert(!todo.isVisible());assert(!pet.isVisible());
 assert.equal(await js(main,"document.querySelector('.practice-mode-tabs [aria-pressed=true]').textContent"),"到期复习");
 console.log(JSON.stringify({status:"passed",actualPreloadAndMainIPC:true,todoCloses:true,mainOpensDueQueue:true}));
 for(const window of BrowserWindow.getAllWindows())window.destroy();app.exit(0);
}catch(error){console.error(error);for(const window of BrowserWindow.getAllWindows())window.destroy();app.exit(1);}
}
void run();
