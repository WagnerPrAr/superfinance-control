import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { gcalendarBridgePlugin } from './server/gcalendarBridge';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    base: './',
    plugins: [
      react(),
      gcalendarBridgePlugin({
        calendarId: env.SUPERFINANCE_GCAL_ID || '',
        calendarName: env.SUPERFINANCE_GCAL_NAME || 'SuperFinance — Alertas Financeiros (Teste)',
        timeZone: env.SUPERFINANCE_TIMEZONE || 'America/Sao_Paulo',
      }),
    ],
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
