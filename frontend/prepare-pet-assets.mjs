import { app, BrowserWindow } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

app.disableHardwareAcceleration();
async function prepare() {
  await app.whenReady();
  const scratch = join(import.meta.dirname, "out", "pet-source-frames");
  mkdirSync(scratch, { recursive: true });
  const page = join(scratch, "decode.html");
  writeFileSync(page, "<!doctype html><html><body></body></html>");
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  await window.loadFile(page);
  for (const action of ["idle", "walk", "click"]) {
    const src = pathToFileURL(join(import.meta.dirname, "public", "assets", `study-buddy-${action}.webm`)).href;
    const result = await window.webContents.executeJavaScript(`(async () => {
      const video = document.createElement("video");
      video.muted = true;
      video.src = ${JSON.stringify(src)};
      document.body.append(video);
      await new Promise((resolve, reject) => {
        video.onloadeddata = resolve; video.onerror = () => reject(new Error("video decode failed"));
      });
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      const frames = [];
      const duration = video.duration;
      for (let time = 0.001; time < duration; time += 1 / 20) {
        await new Promise((resolve) => { video.onseeked = resolve; video.currentTime = Math.min(time, duration - .001); });
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(video, 0, 0);
        frames.push(canvas.toDataURL("image/png").split(",")[1]);
      }
      video.remove();
      return { width: canvas.width, height: canvas.height, duration, frames };
    })()`);
    const directory = join(scratch, action);
    mkdirSync(directory, { recursive: true });
    for (let i = 0; i < result.frames.length; i++) writeFileSync(join(directory, `${String(i).padStart(4, "0")}.png`), Buffer.from(result.frames[i], "base64"));
    writeFileSync(join(directory, "timing.json"), JSON.stringify({ duration: result.duration, frameMs: 50 }));
    console.log(action, result.width, result.height, result.duration, result.frames.length);
  }
  app.exit(0);
}
void prepare().catch((error) => { console.error(error); app.exit(1); });
