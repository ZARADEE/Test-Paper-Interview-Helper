const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const rendererUrl = process.env.PAPER_HELPER_URL || "http://127.0.0.1:5173";
const outputDir = path.resolve(__dirname, "../docs/screenshots");
const viewport = { width: 1440, height: 920 };

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitFor(selector, timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    const found = await global.mainWindow.webContents.executeJavaScript(
      `Boolean(document.querySelector(${JSON.stringify(selector)}))`
    );
    if (found) return;
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${selector}`);
}

async function clickRail(label) {
  const clicked = await global.mainWindow.webContents.executeJavaScript(`
    (() => {
      const button = [...document.querySelectorAll(".rail-button")]
        .find((item) => item.textContent.includes(${JSON.stringify(label)}));
      if (!button) return false;
      button.click();
      return true;
    })()
  `);
  if (!clicked) throw new Error(`Navigation item not found: ${label}`);
}

async function capture(name) {
  await sleep(800);
  const image = await global.mainWindow.webContents.capturePage();
  fs.writeFileSync(path.join(outputDir, `${name}.png`), image.toPNG());
  console.log(`captured ${name}.png`);
}

async function captureScreenshots() {
  fs.mkdirSync(outputDir, { recursive: true });
  const window = new BrowserWindow({
    width: viewport.width,
    height: viewport.height,
    show: false,
    backgroundColor: "#f4efe4",
    webPreferences: {
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false
    }
  });
  global.mainWindow = window;

  await window.loadURL(rendererUrl);
  await waitFor(".app-shell");
  await waitFor(".compose-layout");
  await capture("01-compose");

  await clickRail("小题狂练");
  await waitFor(".practice-layout");
  await waitFor(".practice-setup");
  await capture("02-practice");

  await clickRail("试题导入");
  await waitFor(".import-layout");
  await waitFor(".import-toolbar");
  await capture("03-import");

  await clickRail("试卷模板");
  await waitFor(".template-layout");
  await capture("04-templates");

  window.destroy();
  app.quit();
}

app.whenReady().then(() => {
  captureScreenshots().catch((error) => {
    console.error(error);
    if (global.mainWindow && !global.mainWindow.isDestroyed()) {
      global.mainWindow.destroy();
    }
    app.exit(1);
  });
});
