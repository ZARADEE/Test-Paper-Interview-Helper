const ts=require('typescript'),fs=require('fs'),path=require('path');
function value(n){
 if(ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n))return n.text;
 if(ts.isNumericLiteral(n))return Number(n.text);
 if(n.kind===ts.SyntaxKind.TrueKeyword)return true;
 if(n.kind===ts.SyntaxKind.FalseKeyword)return false;
 if(n.kind===ts.SyntaxKind.NullKeyword)return null;
 if(ts.isPrefixUnaryExpression(n)&&n.operator===ts.SyntaxKind.MinusToken)return -value(n.operand);
 if(ts.isArrayLiteralExpression(n))return n.elements.map(value);
 if(ts.isObjectLiteralExpression(n)){const o={};for(const p of n.properties){if(!ts.isPropertyAssignment(p))throw Error('Nonliteral property');o[p.name.text]=value(p.initializer);}return o;}
 throw Error('Nonliteral syntax '+ts.SyntaxKind[n.kind]);
}
const dir=path.join(__dirname,'out/mock-source'),all=[];
for(const file of fs.readdirSync(dir).filter(f=>/^mock\d+-(a|c[12]?)\.ts$/.test(f))){
 const ast=ts.createSourceFile(file,fs.readFileSync(path.join(dir,file),'utf8'),ts.ScriptTarget.Latest,true);
 for(const statement of ast.statements){if(!ts.isVariableStatement(statement))continue;for(const d of statement.declarationList.declarations){if(d.initializer&&ts.isArrayLiteralExpression(d.initializer)&&!d.initializer.elements.some(ts.isSpreadElement)){all.push(...value(d.initializer).map(q=>({...q,sourceFile:file})));}}}
}
if(all.length!==470||new Set(all.map(q=>q.id)).size!==470)throw Error('Incomplete mock set: '+all.length);
fs.writeFileSync(path.join(__dirname,'out/mock-data.json'),JSON.stringify(all,null,2));console.log(all.length);
