import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'br.com.superfinance.app',
  appName: 'SuperFinance',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
    backgroundColor: '#f2f4f7',
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    StatusBar: {
      overlaysWebView: false,
    },
  },
};

export default config;
