const { contextBridge, ipcRenderer } = require('electron');
const inv = (c) => (...a) => ipcRenderer.invoke(c, ...a);

contextBridge.exposeInMainWorld('api', {
  osc: inv('osc'),
  http: inv('http'),
  open: inv('open'),
  version: inv('version'),
  installUpdate: inv('update:install'),
  onUpdate: (cb) => ipcRenderer.on('update', (_, s) => cb(s)),
  vrc: {
    login: inv('vrc:login'),
    twofa: inv('vrc:2fa'),
    session: inv('vrc:session'),
    logout: inv('vrc:logout'),
    avatars: inv('vrc:avatars'),
    image: inv('vrc:image')
  }
});
