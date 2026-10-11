/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

const base = process.env.VITE_BASE ?? '/';

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'BLE to Cloud Bridge',
        short_name: 'BLE Bridge',
        description: 'Web Bluetooth bridge, dashboard, and Bluetooth-only chat',
        theme_color: '#0f1419',
        background_color: '#0f1419',
        display: 'standalone',
        start_url: `${base}#chat`,
        scope: base,
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // Precache the whole build so the app opens with no network at all.
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        navigateFallback: 'index.html',
      },
      devOptions: {
        // Lets "Add to Home screen" work from the dev server during the adb reverse flow.
        enabled: true,
        type: 'module',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    coverage: { provider: 'v8', include: ['src/**'], exclude: ['src/main.tsx'] },
  },
});
