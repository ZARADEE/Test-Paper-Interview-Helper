// Read-only check: use explicit project paths, not the caller's working directory.
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(process.argv[2]||path.join(__dirname,'../frontend'));
try {
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
  for(const name of Object.keys({...manifest.dependencies,...manifest.devDependencies})){
    const installed=JSON.parse(fs.readFileSync(path.join(root,'node_modules',name,'package.json'),'utf8'));
    const expected=lock.packages['node_modules/'+name]?.version;
    if(!expected||installed.version!==expected)throw Error(name+': missing or different from lockfile');
  }
  for(const relative of ['node_modules/.bin/electron-vite.cmd','node_modules/.bin/tsc.cmd','node_modules/electron/path.txt']) {
    if(!fs.existsSync(path.join(root,relative)))throw Error('Missing '+relative);
  }
  const electronPath=fs.readFileSync(path.join(root,'node_modules/electron/path.txt'),'utf8').trim();
  const binary=path.join(root,'node_modules/electron/dist',electronPath);
  if(!fs.existsSync(binary)||fs.statSync(binary).size<1024)throw Error('Electron binary is missing or incomplete');
  console.log('[paper-helper] Frontend dependencies and Electron binary verified.');
}catch(error){console.error('[paper-helper] '+error.message);process.exitCode=1;}
