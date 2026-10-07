import { federation } from '@module-federation/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import federationConfig from './module-federation.config';

export default defineConfig({
  plugins: [react(), federation(federationConfig)],
  build: {
    // Module Federation resolves shared modules with top-level await before the
    // entry runs; anything older than this cannot express that.
    target: 'chrome89',
  },
});
