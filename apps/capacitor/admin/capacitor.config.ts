import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: process.env.CAP_APP_ID || 'com.ecomate.admin',
  appName: process.env.CAP_APP_NAME || 'EcoMate Admin',
  webDir: process.env.CAP_WEB_DIR || '../../admin/dist',
  bundledWebRuntime: false,
  server: {
    url: process.env.CAP_SERVER_URL || 'http://localhost:5173',
    cleartext: true,
  },
  android: { allowMixedContent: true },
  ios: { contentInset: 'always' },
  plugins: {
    SplashScreen: { launchShowDuration: 2000, backgroundColor: '#ffffff' },
    StatusBar: { style: 'DEFAULT', backgroundColor: '#ffffff' },
  },
};

export default config;
