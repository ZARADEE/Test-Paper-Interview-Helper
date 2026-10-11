import JSCPP from 'JSCPP';
// JSCPP's optional cstdlib.system evaluates host JavaScript. Never load it.
// Keep an explicit header allowlist rather than filtering user source text.
const allowed=['iostream','cctype','cstring','cmath','cstdio','ctime','iomanip','ctype.h','string.h','math.h','stdio.h','time.h'];
JSCPP.includes=Object.fromEntries(allowed.map(name=>[name,JSCPP.includes[name]]));
export const cppRuntime=JSCPP;
