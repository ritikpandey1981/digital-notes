import { contextBridge } from "electron";

const folioApi = Object.freeze({
  platform: process.platform,
  runtime: Object.freeze({
    chromium: process.versions.chrome,
    electron: process.versions.electron,
    node: process.versions.node,
  }),
});

contextBridge.exposeInMainWorld("folio", folioApi);
