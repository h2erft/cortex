/* The bridge between the app and its OWN pages only. The controller's pages are ordinary web content
   loaded over the network; they get nothing from here. */
const { contextBridge, ipcRenderer } = require('electron');
if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('cortexApp', {
    info: () => ipcRenderer.invoke('app:info'),
    setOptions: (o) => ipcRenderer.invoke('app:options', o),
    findStart: () => ipcRenderer.invoke('find:start'),
    findStop: () => ipcRenderer.invoke('find:stop'),
    onFind: (fn) => ipcRenderer.on('find:progress', (_e, s) => fn(s)),
    connect: (url) => ipcRenderer.invoke('find:connect', url),          // -> { ok, err }
    retry: () => ipcRenderer.invoke('find:retry'),                       // try every address of the saved controller -> { ok }
    forget: (url) => ipcRenderer.invoke('find:forget', url),
    open: () => ipcRenderer.invoke('app:open'),                          // back to the saved controller
    phone: () => ipcRenderer.invoke('phone:info'),                     // -> { name, remote: { url, svg }, local: { url, svg } }
    testNotify: () => ipcRenderer.invoke('app:test-notify'),
    checkUpdate: () => ipcRenderer.invoke('update:check'),
    installUpdate: () => ipcRenderer.invoke('update:install'),
    leaveBeta: () => ipcRenderer.invoke('update:leave-beta'),
    revertToStable: () => ipcRenderer.invoke('update:revert'),
    onUpdate: (fn) => ipcRenderer.on('update:state', (_e, s) => fn(s))
  });
}
