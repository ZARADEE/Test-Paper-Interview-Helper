// The inline surface can paint before React and the application are evaluated.
async function mount(): Promise<void> {
  try {
    const renderer = await import('./render');
    window.paperBoot?.modulesReady();
    renderer.mountApplication();
  } catch (error) {
    console.error('界面入口加载失败', error);
    if (window.paperBoot) window.paperBoot.fail(error);
    else {
      const root = document.getElementById('root');
      if (root) {
        const message = document.createElement('p');
        message.textContent = '界面加载失败，请重新打开窗口。';
        root.replaceChildren(message);
      }
    }
  }
}

if (window.paperBoot && !document.hidden) {
  // No minimum playback; the fallback also handles minimized windows.
  let started = false;
  const begin = () => { if (started) return; started = true; clearTimeout(fallback); void mount(); };
  const fallback = window.setTimeout(begin, 100);
  requestAnimationFrame(() => requestAnimationFrame(begin));
} else void mount();
