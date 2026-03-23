const e = require('electron');
console.log('type:', typeof e);
console.log('versions:', JSON.stringify(process.versions));
console.log('electron ver:', process.versions && process.versions.electron);

if (typeof e === 'object' && e.app) {
    e.app.whenReady().then(() => {
        const win = new e.BrowserWindow({ width: 400, height: 600 });
        win.loadURL('data:text/html,<h1>Electron ishlamoqda!</h1>');
    });
    e.app.on('window-all-closed', () => process.exit(0));
} else {
    console.log('Electron API yoq, string:', e);
    process.exit(1);
}
