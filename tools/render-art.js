// Renders docs/art/banner.html to docs/banner.png (2x, for the README) and
// docs/social-preview.png (1280x640, for GitHub's social preview).
//   npx electron tools/render-art.js
'use strict';
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const root = path.join(__dirname, '..');
const page = path.join(root, 'docs', 'art', 'banner.html');

app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1280, height: 640, useContentSize: true, frame: false, show: false, webPreferences: { offscreen: true } });
  await win.loadFile(page);
  // Give fonts and the screenshot a moment to land.
  await new Promise((r) => setTimeout(r, 1200));
  const img = await win.webContents.capturePage();
  const write = (file, image) => {
    fs.writeFileSync(path.join(root, 'docs', file), image.toPNG());
    const { width, height } = image.getSize();
    console.log(`wrote docs/${file} ${width}x${height}`);
  };
  write('banner.png', img.resize({ width: 2560, height: 1280, quality: 'best' }));
  write('social-preview.png', img.resize({ width: 1280, height: 640, quality: 'best' }));
  app.quit();
});
