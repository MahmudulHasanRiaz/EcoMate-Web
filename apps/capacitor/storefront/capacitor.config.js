/** @type {import('@capacitor/cli').CapacitorConfig} */
const config = {
  appId: process.env.CAP_APP_ID || 'com.ecomate.storefront',
  appName: process.env.CAP_APP_NAME || 'EcoMate',
  webDir: process.env.CAP_WEB_DIR || '../../storefront/.next',
  bundledWebRuntime: false,
  server: {
    url: process.env.CAP_SERVER_URL || 'http://localhost:3000',
    cleartext: true,
    allowNavigation: [(process.env.CAP_SERVER_URL || 'http://localhost:3000').replace(/https?:\/\//, '')],
  },
  android: {
    allowMixedContent: true,
  },
  ios: {
    contentInset: 'always',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#ffffff',
      androidScaleType: 'CENTER_CROP',
    },
    StatusBar: {
      style: 'DEFAULT',
      backgroundColor: '#ffffff',
    },
  },
};

export default config;
