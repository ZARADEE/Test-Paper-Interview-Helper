import { contextBridge } from "electron";

contextBridge.exposeInMainWorld("paperHelper", {
  platform: process.platform
});

