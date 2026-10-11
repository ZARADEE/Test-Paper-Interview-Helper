declare module 'JSCPP' {
  export type CppDebugger={done:boolean;continue:()=>false|{v:number};nextNode:()=>{sLine:number}|undefined;variable:()=>{name:string;type:string;value:string}[]};
  const JSCPP:{includes:Record<string,unknown>;run:(source:string,input:string,config:{stdio:{write:(text:string)=>void};debug?:boolean;maxTimeout?:number})=>number|CppDebugger};
  export default JSCPP;
}
declare module 'printf/lib/printf.js' {export class Formatter{constructor(format:string);format(...values:unknown[]):string;}}
