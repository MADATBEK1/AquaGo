'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 420,
        height: 820,
        minWidth: 380,
        minHeight: 650,
        resizable: true,
        center: true,
        title: 'AquaGo – Suv Yetkazib Berish',
        backgroundColor: '#0f172a',
        frame: false,
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js'),
            webSecurity: false
        }
    });

    // Dastur endi to'g'ridan to'g'ri saytga ulanadi! 
    // Shunda barcha yangilanishlar srazi elektron dasturga yetib boradi.
    mainWindow.loadURL('https://aquago-mobile-app.netlify.app/');

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Ichki havolalarni (landing.html va h.k.) app ichida ochish
    mainWindow.webContents.on('will-navigate', (event, url) => {
        const parsed = new URL(url);
        // Agar o'z saytimiz bo'lsa — app ichida ochish
        if (parsed.hostname === 'aquago-mobile-app.netlify.app' || 
            parsed.hostname === 'localhost' ||
            parsed.hostname === 'web-production-12311.up.railway.app') {
            return; // Ruxsat berish
        }
        // Tashqi havolalarni brauzerda ochish
        event.preventDefault();
        shell.openExternal(url);
    });

    // Tashqi havolalarni brauzerda ochish
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });
}

app.whenReady().then(() => {
    createWindow();

    ipcMain.on('window-minimize', () => {
        if (mainWindow) mainWindow.minimize();
    });

    ipcMain.on('window-maximize', () => {
        if (mainWindow) {
            if (mainWindow.isMaximized()) mainWindow.unmaximize();
            else mainWindow.maximize();
        }
    });

    ipcMain.on('window-close', () => {
        if (mainWindow) mainWindow.close();
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
