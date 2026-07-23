import type { CapacitorConfig } from '@capacitor/cli';

const appName = process.env.CAP_APP_NAME || 'EcoMate';
const serverUrl = process.env.CAP_SERVER_URL || 'http://localhost:3000';

const config: CapacitorConfig = {
  appId: process.env.CAP_APP_ID || 'com.ecomate.storefront',
  appName,
  webDir: process.env.CAP_WEB_DIR || '../../storefront/.next',
  bundledWebRuntime: false,
  server: {
    url: serverUrl,
    cleartext: true,
    allowNavigation: [serverUrl.replace(/https?:\/\//, '')],
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
