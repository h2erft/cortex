// The page gets a small, fixed set of things it may ask the desktop app to do. Nothing else crosses over.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('cmdApp', {
  info: () => ipcRenderer.invoke('app:info'),
  setOptions: (o) => ipcRenderer.invoke('app:options', o),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  leaveBeta: () => ipcRenderer.invoke('update:leave-beta'),      // { ok, onBeta, current, stable, canRevert }
  revertToStable: () => ipcRenderer.invoke('update:revert'),     // downloads the newest stable installer; then installUpdate()
  onUpdate: (cb) => ipcRenderer.on('update:state', (_e, s) => { try { cb(s); } catch (_) {} }),
  notify: (title, body) => ipcRenderer.invoke('app:notify', { title: String(title || '').slice(0, 120), body: String(body || '').slice(0, 300) }),
  show: () => ipcRenderer.invoke('app:show'),
  // { base, method, path, body } -> { ok, status, json, err }. The app only sends what bridge.js allows.
  controller: (req) => ipcRenderer.invoke('ctl:request', req)
});
