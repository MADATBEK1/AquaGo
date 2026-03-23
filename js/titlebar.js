/* ===================================================
   AquaGo – Title Bar Controls (JS)
   =================================================== */

(function () {
    // Electron ni aniqlash
    const isElectron = typeof window !== 'undefined' && window.electronAPI && window.electronAPI.isElectron;

    if (isElectron) {
        // Body ga class qo'shish
        document.body.classList.add('is-electron');
    }

    // Title bar tugmalari
    window.tbMinimize = function () {
        if (window.electronAPI) window.electronAPI.minimize();
    };

    window.tbMaximize = function () {
        if (window.electronAPI) window.electronAPI.maximize();
    };

    window.tbClose = function () {
        if (window.electronAPI) window.electronAPI.close();
    };
})();
