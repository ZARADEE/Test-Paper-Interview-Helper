const { app, BrowserWindow } = require('electron');
const { createServer } = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'paper-boot-smoke-')));

const renderer = path.join(__dirname, 'out', 'renderer');
const checks = [];
const errors = [];
let holdRenderer = false;
let failNextRenderer = false;
let releaseRenderer;
let rendererStarted;
const rendererStartedPromise = new Promise(resolve => { rendererStarted = resolve; });
const delayedRenderer = new Promise(resolve => { releaseRenderer = resolve; });
let rendererRequestCount = 0;
let server;
let window;

const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml' };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function js(code) { return window.webContents.executeJavaScript(code); }
function check(name, pass, detail) {
  checks.push({ name, pass, ...(detail === undefined ? {} : { detail }) });
  if (!pass) throw new Error(name + ': ' + JSON.stringify(detail));
}
async function until(predicate, description, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const result = await predicate(); if (result) return result; } catch { /* Page is still navigating. */ }
    await wait(40);
  }
  throw new Error('Timed out waiting for ' + description);
}
async function capture(name) {
  const image = await window.webContents.capturePage();
  fs.writeFileSync(path.join(os.tmpdir(), 'paper-boot-' + name + '.png'), image.toPNG());
}
function bootFromQuery(url) {
  return new Promise(resolve => {
    window.webContents.once('dom-ready', () => resolve());
    void window.loadURL(url).catch(error => errors.push('navigation: ' + error.message));
  });
}
function navigate(url) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out loading ' + url)), 10000);
    window.webContents.once('dom-ready', () => { clearTimeout(timer); resolve(); });
    void window.loadURL(url).catch(error => { clearTimeout(timer); reject(error); });
  });
}
function assetPath(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://127.0.0.1').pathname);
  if (pathname === '/') return path.join(renderer, 'index.html');
  const full = path.resolve(renderer, '.' + pathname);
  if (!full.startsWith(renderer + path.sep) && full !== path.join(renderer, 'index.html')) return null;
  return full;
}

async function run() {
  const index = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
  check('boot markup and styles are inline before deferred module execution', index.indexOf('id="paper-boot"') >= 0 && index.indexOf('id="paper-boot-style"') < index.indexOf('type="module"') && index.includes('id="paper-boot-script"'));
  const entryChunk = fs.readdirSync(path.join(renderer, 'assets')).find(file => /^index-.*\.js$/.test(file));
  check('main app is a separately loaded module', Boolean(entryChunk) && /import\("\.\/render-[^"]+\.js"\)/.test(fs.readFileSync(path.join(renderer, 'assets', entryChunk), 'utf8')));

  server = createServer(async (request, response) => {
    const file = assetPath(request.url);
    if (!file) { response.writeHead(403).end(); return; }
    if (/[/\\]render-[^/\\]+\.js$/.test(file)) {
      rendererRequestCount += 1;
      rendererStarted();
      if (failNextRenderer) { failNextRenderer = false; response.writeHead(503).end('simulated module failure'); return; }
      if (holdRenderer) {
        await delayedRenderer;
        holdRenderer = false;
      }
    }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      response.end(data);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  window = new BrowserWindow({ width: 1440, height: 920, show: false, backgroundColor: '#f4efe4', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  window.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message); });

  holdRenderer = true;
  await bootFromQuery(url + '?smoke=slow');
  await rendererStartedPromise;
  await until(() => js("document.querySelector('#paper-boot')?.dataset.state === 'loading' && document.querySelector('#root')?.hasAttribute('inert')"), 'inline surface visible before React chunk');
  const firstFrame = await js("({visible:!!document.querySelector('#paper-boot'),rootEmpty:document.getElementById('root').childElementCount===0,background:getComputedStyle(document.querySelector('#paper-boot')).backgroundColor,petSrc:document.querySelector('#boot-pet-image').src})");
  check('loading surface appears before delayed React bundle', firstFrame.visible && firstFrame.rootEmpty && firstFrame.background === 'rgb(244, 239, 228)', firstFrame);
  await capture('startup-integrated-loading');
  window.setContentSize(980, 680);
  await wait(120);
  const narrowFrame = await js("({width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,height:document.documentElement.clientHeight})");
  check('loading surface fits the main window minimum width without horizontal overflow', narrowFrame.scrollWidth <= narrowFrame.width, narrowFrame);
  window.setContentSize(1440, 920);
  await js('window.paperBoot.modulesReady()');
  check('module stage updates from real module callback', await js("document.getElementById('boot-status').textContent === '正在铺开你的工作台'"));
  releaseRenderer();
  await until(() => js("Boolean(document.querySelector('.app-shell')) && !document.getElementById('paper-boot')"), 'home content replaces loading surface');
  check('first real application frame removes the loading surface', await js("Boolean(document.querySelector('.app-shell')) && !document.getElementById('root').hasAttribute('inert')"));

  await navigate(url + '?surface=pet&smoke=aux');
  await until(() => js("Boolean(document.querySelector('.desktop-pet-surface'))"), 'auxiliary surface loads');
  check('auxiliary windows do not show the main-window animation', await js("document.documentElement.dataset.paperSurface === 'aux' && !document.getElementById('paper-boot')"));

  failNextRenderer = true;
  await navigate(url + '?smoke=error');
  await until(() => js("document.querySelector('#paper-boot')?.dataset.state === 'error'"), 'module error is surfaced');
  await js("document.getElementById('boot-details-toggle').click()");
  check('failed module keeps recovery controls in the same surface', await js("!document.getElementById('boot-reload').hidden && !document.getElementById('boot-details').hidden && document.getElementById('boot-details').textContent.length > 0"));
  await wait(80);
  await capture('startup-integrated-error');

  check('simulated module failure is reported', errors.some(message => message.includes('Failed to fetch dynamically imported module')), errors);
  errors.length = 0;
  await navigate(url + '?smoke=ready');
  await until(() => js("Boolean(document.querySelector('.app-shell')) && !document.getElementById('paper-boot')"), 'reload recovers from failed module');
  check('a fresh page load recovers from the module failure', await js("Boolean(document.querySelector('.app-shell')) && !document.getElementById('paper-boot')"));
  check('renderer has no uncaught errors', errors.length === 0, errors);
  console.log(JSON.stringify({ status: 'passed', checks, interceptedRendererChunks: rendererRequestCount }, null, 2));
}

app.whenReady().then(async () => {
  try { await run(); }
  catch (error) { console.error(error); console.log(JSON.stringify({ status: 'failed', checks, errors }, null, 2)); process.exitCode = 1; }
  finally {
    releaseRenderer?.();
    if (window && !window.isDestroyed()) window.destroy();
    server?.close();
    app.exit(process.exitCode || 0);
  }
});
