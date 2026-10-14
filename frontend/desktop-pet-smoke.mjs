import { app, BrowserWindow, ipcMain, screen } from "electron";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const profiles = join(import.meta.dirname, 'out', 'pet-smoke-profiles');
mkdirSync(profiles, { recursive: true });
const profile = mkdtempSync(join(profiles, "profile-"));
app.setPath("userData", profile);
writeFileSync(join(profile, "desktop-pet.json"), JSON.stringify({ pack: "rubber-duck", size: 220, roaming: true }));
await import("./out/main/main.js");
const output = join(import.meta.dirname, "out", "pet-smoke");
mkdirSync(output, { recursive: true });
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const js = (window, source) => Promise.race([window.webContents.executeJavaScript(source), delay(8000).then(() => { throw Error("Renderer timeout: " + source.slice(0,100)); })]);
async function waitFor(check, label) {
  const deadline = Date.now() + 12000;
  while (Date.now() < deadline) {
    const result = await check();
    if (result) return result;
    await delay(80);
  }
  throw new Error("Timed out waiting for " + label);
}
async function ready(window, selector) {
  await waitFor(() => !window.webContents.isLoading(), "renderer loaded");
  await waitFor(() => js(window, "Boolean(document.querySelector(" + JSON.stringify(selector) + "))"), selector);
}
async function screenshot(window, name) {
  await delay(180);
  writeFileSync(join(output, name + ".png"), (await window.webContents.capturePage()).toPNG());
}
function fixedSize(window, size) {
  assert.equal(window.isResizable(), false, "window must not be resizable");
  for (const dimensions of [window.getSize(), window.getMinimumSize(), window.getMaximumSize()]) {
    assert(dimensions.every((value) => Math.abs(value - size) <= 2), "unexpected size: " + dimensions + " expected " + size);
  }
}
async function imageReady(window) {
  await waitFor(() => js(window, "document.querySelector('.pet-artwork')?.naturalWidth === 256"), "normalized artwork decoded");
}

async function runSmoke() {
  try {
    await app.whenReady();
    const main = await waitFor(() => BrowserWindow.getAllWindows().find((w) => w.getSize()[0] > 900), "main window");
    const getPet = () => waitFor(() => BrowserWindow.getAllWindows().find((w) => w !== main && w.isVisible() && w.getSize()[0] <= 282), "ambient window");
    await ready(main, ".home-pet-choice");
    assert.equal(await js(main, "document.querySelectorAll('.home-pet-choice').length"), 4);
    assert.equal((await js(main, "window.paperHelper.getPetSettings()")).pack, "doro", "legacy duck should migrate to Doro");
    await screenshot(main, "main");
    main.close();
    let pet = await getPet();
    await ready(pet, ".pack-doro.is-pet");
    fixedSize(pet, 220);
    assert(!main.isVisible());
    assert.equal(await js(pet, "getComputedStyle(document.documentElement).backgroundColor"), "rgba(0, 0, 0, 0)");
    await imageReady(pet);
    await waitFor(() => js(pet, "document.querySelector('main').dataset.action === 'walk'"), "automatic walking");
    const start = pet.getPosition();
    await waitFor(() => { const p = pet.getPosition(); return Math.abs(p[0] - start[0]) > 12 && Math.abs(p[1] - start[1]) > 6; }, "two-axis autonomous motion");
    fixedSize(pet, 220);
    await js(pet, "window.paperHelper.setPetDragging(true)");
    await delay(100);
    const pausedPosition = pet.getPosition();
    const frame = (await pet.webContents.capturePage()).toBitmap();
    await waitFor(async () => !frame.equals((await pet.webContents.capturePage()).toBitmap()), "Doro animated frames");
    assert.deepEqual(pet.getPosition(), pausedPosition, "drag must pause motion");
    await screenshot(pet, "doro-walk");

    // Exercise the exact movement IPC hundreds of times on fractional Windows DPI.
    const area = screen.getDisplayMatching(pet.getBounds()).workArea;
    const baseX = area.x + 90, baseY = area.y + 90;
    for (let batch = 0; batch < 20; batch++) {
      await js(pet, "(() => { for(let i=0;i<20;i++) window.paperHelper.dragPetTo(" + baseX + " + i * 3, " + baseY + " + i * 2); })()");
      await delay(15);
      fixedSize(pet, 220);
    }
    let prevented = false;
    pet.emit("will-resize", { preventDefault: () => { prevented = true; } }, { x: baseX, y: baseY, width: 900, height: 900 });
    assert(prevented, "native edge resize must be cancelled");
    pet.setBounds({ width: 900, height: 900 });
    await delay(150);
    fixedSize(pet, 220);
    console.log("PASS: 400 drag updates, native edge resize cancelled, fixed dimensions");

    // Each edge is tested in isolation. State continues in main, so IPC cannot grow the window.
    const box = { x: 12 / 256, y: 48 / 256, width: 232 / 256, height: 196 / 256 };
    for (const edge of ["left", "right", "top", "bottom"]) {
      console.log("CHECK edge",edge);
      await js(main, "window.paperHelper.setPetRoaming(false)");
      await delay(50);
      await js(main, "window.paperHelper.setPetRoaming(true)");
      await ready(pet, "[data-action=walk]");
      await js(pet, "window.paperHelper.setPetDragging(true)");
      await js(pet, "window.paperHelper.setPetAction('walk', " + JSON.stringify(box) + ")");
      const left = area.x - box.x * 220, right = area.x + area.width - (box.x + box.width) * 220;
      const top = area.y - box.y * 220, bottom = area.y + area.height - (box.y + box.height) * 220;
      // Cross the artwork boundary by one DIP, keeping the window center on this display.
      const targetX = edge === "left" ? left - 1 : edge === "right" ? right + 1 : (left + right) / 2;
      const targetY = edge === "top" ? top - 1 : edge === "bottom" ? bottom + 1 : (top + bottom) / 2;
      await js(pet, "window.paperHelper.dragPetTo(" + targetX + "," + targetY + ")");
      await delay(60);
      await js(pet, "window.paperHelper.setPetDragging(false)");
      const edgeStart = pet.getPosition();
      await waitFor(() => {
        const [px, py] = pet.getPosition();
        assert(px + box.x * 220 >= area.x - 2 && px + (box.x + box.width) * 220 <= area.x + area.width + 2, JSON.stringify({ edge, px, py, area, box }));
        assert(py + box.y * 220 >= area.y - 2 && py + (box.y + box.height) * 220 <= area.y + area.height + 2);
        return edge === "left" ? px > edgeStart[0] + 5 : edge === "right" ? px < edgeStart[0] - 5 : edge === "top" ? py > edgeStart[1] + 5 : py < edgeStart[1] - 5;
      }, edge + " boundary reflection");
      fixedSize(pet, 220);
    }
    console.log("PASS: all four work-area edges reflect without clipping or growth");

    await js(main, "window.paperHelper.setPetRoaming(false)");
    await ready(pet, "[data-action=idle]");
    const still = pet.getPosition();
    await delay(300);
    assert.deepEqual(pet.getPosition(), still, "roaming off must stop motion");
    for (const display of screen.getAllDisplays()) {
      const target = display.workArea;
      for (let i = 0; i < 40; i++) {
        await js(pet, "window.paperHelper.dragPetTo(" + (target.x + 70 + i) + "," + (target.y + 90 + i) + ")");
      }
      await delay(150);
      fixedSize(pet, 220);
      assert.equal(screen.getDisplayMatching(pet.getBounds()).id, display.id);
      console.log("PASS: fixed 220 DIP on display scale", display.scaleFactor, pet.getBounds());
    }
    await js(pet, "window.paperHelper.dragPetTo(" + baseX + "," + baseY + ")");
    await delay(100);
    for (const pack of ["maid", "paper-cat", "focus-bot", "doro"]) {
      await js(main, "window.paperHelper.setPetPack(" + JSON.stringify(pack) + ")");
      await ready(pet, ".pack-" + pack);
      if (pack === "maid" || pack === "doro") await imageReady(pet);
      await screenshot(pet, pack);
      fixedSize(pet, 220);
    }
    await js(main, "(() => { const d=new Date();const today=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'); localStorage.setItem('paper-helper.home.todo-notebook.v1',JSON.stringify([{id:'one',text:'今日数学练习',date:today,done:false},{id:'two',text:'已完成的题',date:today,done:true},{id:'old',text:'昨日任务',date:'2000-01-01',done:false}]));})()");
    await js(pet, "document.querySelector('main').click()");
    await ready(pet, ".pet-artwork.is-click");
    await screenshot(pet, "doro-click");
    const todos = await waitFor(() => BrowserWindow.getAllWindows().find(w => w !== main && w !== pet && w.isVisible()), "todo panel opens");
    await ready(todos, ".pet-todo-panel");
    assert.equal(await js(todos, "document.querySelectorAll('.pet-todo-scroll li').length"), 1);
    assert.equal(await js(todos, "document.body.innerText.includes('昨日任务')"), false);
    const panelBounds = todos.getBounds();
    await js(pet, "document.querySelector('main').click()");
    await delay(100);
    assert.deepEqual(todos.getBounds(), panelBounds, "repeated click must not resize panel");
    fixedSize(pet, 220);
    await js(main, "(() => {const key='paper-helper.home.todo-notebook.v1';const items=JSON.parse(localStorage.getItem(key));items[0].done=true;localStorage.setItem(key,JSON.stringify(items));})()");
    await waitFor(() => js(todos, "document.querySelectorAll('.pet-todo-scroll li').length===0"), "live todo completion sync");
    await screenshot(todos, "todo-panel");
    await js(todos, "window.paperHelper.hidePetTodos()");
    await waitFor(() => !todos.isVisible(), "close todo panel");

    await ready(pet, ".pet-artwork.is-idle");
    await ready(pet, ".pet-artwork.is-special");
    await screenshot(pet, "doro-special");

    for (const size of [160, 280, 220]) {
      const oldId = pet.id;
      await js(main, "window.paperHelper.setPetSize(" + size + ")");
      await waitFor(() => pet.isDestroyed(), "old size window destroyed");
      pet = await getPet();
      await ready(pet, ".pack-doro.is-pet");
      assert.notEqual(pet.id, oldId);
      fixedSize(pet, size);
      await imageReady(pet);
      await screenshot(pet, "doro-size-" + size);
    }
    await js(pet, "window.paperHelper.showAmbient('ball')");
    const ball = await getPet();
    await ready(ball, ".desktop-pet-ball");
    fixedSize(ball, 92);
    await screenshot(ball, "ball");
    await js(ball, "(() => { const el = document.querySelector('main'); el.setPointerCapture = () => {}; el.hasPointerCapture = () => false; el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: 1, clientY: 30, screenX: 210, screenY: 180 })); for(let i=0;i<50;i++) el.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, screenX: 220+i, screenY: 200+i })); el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); el.click(); })()");
    await delay(150);
    fixedSize(ball, 92);
    assert(!main.isVisible(), "dragging ball accidentally opened main");
    await js(ball, "window.paperHelper.showAmbient('pet')");
    pet = await getPet();
    await ready(pet, ".pack-doro.is-pet");
    fixedSize(pet, 220);
    await js(main, "window.paperHelper.setPetRoaming(true)");
    await ready(pet, "[data-action=walk]");
    await js(pet, "window.paperHelper.showMain()");
    await waitFor(() => main.isVisible() && !pet.isVisible(), "main restored");
    const hidden = pet.getPosition();
    await delay(300);
    assert.deepEqual(pet.getPosition(), hidden, "hidden pet must stop");
    await ready(pet, ".is-paused");
    assert((await js(pet, "document.querySelector('.pet-artwork').src")).endsWith(".png"), "hidden animation must use static frame");
    await delay(500);
    const saved = JSON.parse(readFileSync(join(profile, "desktop-pet.json"), "utf8"));
    assert.equal(saved.pack, "doro"); assert.equal(saved.size, 220); assert.equal(saved.roaming, true); assert.equal(saved.mode, "pet");
    assert(saved.position.every(Number.isFinite));
    console.log("PASS: Doro migration/animation, four packs, drag pause, click/special recovery, explicit sizes, ball, hidden pause, persistence, main restore");
    console.log("Screenshots:", output);
    ipcMain.emit("quit-app");
  } catch (error) { console.error(error); app.exit(1); }
}
// Do not await app readiness at module level: it prevents the ready event.
void runSmoke();
