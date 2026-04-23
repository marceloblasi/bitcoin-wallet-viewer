const { app, BrowserWindow, session } = require('electron');
const path = require('path');

function createWindow () {
  // Spoof headers to bypass Cloudflare blocking on Trezor APIs
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*.trezor.io/*'] },
    (details, callback) => {
      details.requestHeaders['Origin'] = 'https://trezor.io';
      details.requestHeaders['Referer'] = 'https://trezor.io/';
      details.requestHeaders['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'icon.ico'), // Will be generated
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    },
    autoHideMenuBar: true
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
