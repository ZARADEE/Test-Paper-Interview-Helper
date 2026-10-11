import type {CppDebugger} from 'JSCPP';
import {cppRuntime as JSCPP} from './cppRuntime';
export type CppRequest={type:'run'|'debug'|'step';code?:string;input?:string};
export type CppReply={status:'done'|'paused'|'error';output:string;line?:number;exitCode?:number;variables?:{name:string;type:string;value:string}[];error?:string};
let debuggerState:CppDebugger|undefined,output='';
function advance():CppReply {
 if(!debuggerState)throw Error('请先开始调试');
 const value=debuggerState.continue();
 return {status:debuggerState.done?'done':'paused',output,line:debuggerState.nextNode()?.sLine,exitCode:value!==false?value?.v:undefined,variables:debuggerState.done?[]:debuggerState.variable().filter(v=>typeof v.type==='string'&&!v.type.includes('(')).slice(0,64)};
}
self.addEventListener('message',(event:MessageEvent<CppRequest>)=>{
 try {
  const request=event.data;
  if(request.type==='step'){self.postMessage(advance());return;}
  output='';debuggerState=undefined;
  const code=request.code||'',input=request.input||'';
  if(code.length>32768||input.length>8192)throw Error('代码上限 32K 字符，输入上限 8K 字符');
  const result=JSCPP.run(code,input,{debug:request.type==='debug',maxTimeout:2500,stdio:{write(text:string){if(output.length+text.length>65536)throw Error('输出超过 64K 字符，运行已停止');output+=text;}}});
  if(typeof result==='number')self.postMessage({status:'done',output,exitCode:result} satisfies CppReply);
  else {debuggerState=result;self.postMessage(advance());}
 }catch(error){debuggerState=undefined;self.postMessage({status:'error',output,error:error instanceof Error?error.message:String(error)} satisfies CppReply);}
});
