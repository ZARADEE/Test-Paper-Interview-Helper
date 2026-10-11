// JSCPP requires a CommonJS function in both Vite dev and production workers.
// Use string formatting only; never call printf's Node stream overload.
const {Formatter}=require('printf/lib/printf.js');
module.exports=function printf(format,...values){return new Formatter(format).format(...values);};
