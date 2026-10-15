/* A tiny classic script keeps startup UI independent of React and network chunks. */
(() => {
  const screen = document.getElementById('paper-boot');
  const style = document.getElementById('paper-boot-style');
  if (!screen) return;
  if (document.documentElement.dataset.paperSurface === 'aux') { screen.remove(); style?.remove(); return; }
  const root = document.getElementById('root');
  const status = document.getElementById('boot-status');
  const recovery = document.getElementById('boot-recovery');
  const problem = document.getElementById('boot-problem');
  const details = document.getElementById('boot-details');
  const detailsButton = document.getElementById('boot-details-toggle');
  const image = document.getElementById('boot-pet-image');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let finished = false, failed = false, leaving = false, frame = 0, secondFrame = 0, exitTimer = 0, petChosen = false;
  const timers = new Set();
  const later = (callback, ms) => { const id = setTimeout(() => { timers.delete(id); callback(); }, ms); timers.add(id); return id; };
  const mark = name => { try { performance.mark(name); } catch { /* Diagnostics never block rendering. */ } };
  mark('paper:boot-visible');
  root?.setAttribute('inert', '');
  root?.setAttribute('aria-hidden', 'true');

  const reload = () => location.reload();
  const toggleDetails = () => { details.hidden = !details.hidden; detailsButton.setAttribute('aria-expanded', String(!details.hidden)); };
  const background = () => { screen.classList.toggle('is-backgrounded', document.hidden); if (leaving && document.hidden) remove(); };
  function cleanup() {
    timers.forEach(clearTimeout); timers.clear(); clearTimeout(exitTimer); cancelAnimationFrame(frame); cancelAnimationFrame(secondFrame);
    window.removeEventListener('error', onError, true); window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('pagehide', cleanup); document.removeEventListener('visibilitychange', background);
    document.getElementById('boot-reload').removeEventListener('click', reload); detailsButton.removeEventListener('click', toggleDetails);
    image.removeEventListener('load', imageLoaded); image.removeEventListener('error', imageFailed);
  }
  function remove() {
    if (finished) return;
    finished = true; cleanup();
    const hadFocus = screen.contains(document.activeElement);
    screen.remove(); style?.remove(); root?.removeAttribute('inert'); root?.removeAttribute('aria-hidden');
    document.documentElement.removeAttribute('data-paper-boot');
    if (hadFocus) root?.querySelector('button')?.focus({ preventScroll: true });
    mark('paper:boot-removed'); delete window.paperBoot;
  }
  function fail(error) {
    if (finished || leaving || failed) return;
    failed = true; timers.forEach(clearTimeout); timers.clear();
    screen.dataset.state = 'error'; screen.setAttribute('aria-busy', 'false'); status.textContent = '界面暂时没有加载成功';
    problem.textContent = '可以重新加载界面。已有题库和学习记录不会因此被删除。';
    details.textContent = String(error?.message || error || '界面资源加载失败').slice(0, 1500);
    recovery.hidden = false; detailsButton.hidden = false; mark('paper:boot-error');
  }
  function onError(event) {
    if (event.target instanceof HTMLScriptElement) fail('未能加载界面脚本，请重新加载。');
    else if (event.error) fail(event.error);
  }
  function onRejection(event) {
    if (/dynamically imported module|module script|loading chunk|chunkloaderror/i.test(String(event.reason?.message || event.reason))) fail(event.reason);
  }
  function imageLoaded() { if (!finished) image.parentElement.classList.add('is-loaded'); }
  function imageFailed() { if (!finished) image.parentElement.hidden = true; }
  image.addEventListener('load', imageLoaded); image.addEventListener('error', imageFailed);
  const assets = { maid: 'maid/idle.png', doro: 'doro/idle.png', 'paper-cat': 'maid/idle.png', 'focus-bot': 'doro/idle.png' };
  function pet(pack) {
    if (finished || petChosen) return;
    petChosen = true;
    image.src = new URL('./assets/' + (assets[pack] || assets.maid), document.baseURI).href;
  }
  if (window.paperHelper?.getPetSettings) {
    try { Promise.resolve(window.paperHelper.getPetSettings()).then(s => pet(s?.pack), () => pet('maid')); }
    catch { pet('maid'); }
    later(() => pet('maid'), 150);
  } else pet('maid');
  document.getElementById('boot-reload').addEventListener('click', reload);
  detailsButton.addEventListener('click', toggleDetails);
  window.addEventListener('error', onError, true); window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', cleanup); document.addEventListener('visibilitychange', background); background();
  later(() => {
    if (leaving || failed) return;
    recovery.hidden = false; problem.textContent = '界面加载时间比平时长。你可以继续等待，或重新加载。';
  }, 12000);
  later(() => { if (!leaving) document.getElementById('boot-tip').textContent = '有些答案，要亲手推一遍才清晰。'; }, 6000);

  window.paperBoot = {
    modulesReady() {
      if (finished || failed || leaving) return;
      status.textContent = '正在铺开你的工作台'; mark('paper:modules-ready');
    },
    ready() {
      if (finished || failed || leaving) return;
      leaving = true; mark('paper:react-committed'); timers.forEach(clearTimeout); timers.clear();
      screen.dataset.state = 'ready'; screen.setAttribute('aria-busy', 'false');
      status.textContent = '准备好了，从这一题开始。';
      document.getElementById('boot-ready-note').textContent = '书桌已就位'; recovery.hidden = true;
      if (document.hidden || reduced.matches) { remove(); return; }
      frame = requestAnimationFrame(() => {
        secondFrame = requestAnimationFrame(() => {
          if (finished) return;
          mark('paper:home-painted'); screen.classList.add('is-leaving'); exitTimer = setTimeout(remove, 210);
        });
      });
    },
    fail
  };
})();
