import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: process.env.CAP_APP_ID || 'com.ecomate.pos',
  appName: process.env.CAP_APP_NAME || 'EcoMate POS',
  webDir: process.env.CAP_WEB_DIR || '../../pos/dist',
  bundledWebRuntime: false,
  server: {
    url: process.env.CAP_SERVER_URL || 'http://localhost:5174',
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
