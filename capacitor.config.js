const config = {
    appId: 'uz.aquago.app',
    appName: 'AquaGo',
    webDir: '.',
    server: {
        androidScheme: 'file'
    },
    android: {
        allowMixedContent: true,
        captureInput: true,
        webContentsDebuggingEnabled: false
    },
    plugins: {
        SplashScreen: {
            launchShowDuration: 2000,
            backgroundColor: '#0f172a',
            showSpinner: false
        }
    }
};

module.exports = config;
