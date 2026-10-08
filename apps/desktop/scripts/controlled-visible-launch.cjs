const { app } = require('electron');
const windows = [];
app.on('browser-window-created', (_event, window) => {
  windows.push(window);
  setTimeout(() => {
    if (window.isDestroyed()) return;
    window.webContents.closeDevTools();
    window.show();
    window.focus();
    console.log('Orchestra window shown', window.getTitle(), window.isVisible());
  }, 2000);
  window.webContents.once('did-finish-load', () => {
    window.show();
    window.focus();
  });
});
require('../electron/main.cjs');
