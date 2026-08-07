import { federation } from '@module-federation/vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';
import federationConfig from './module-federation.config';

export default defineConfig({
  plugins: [svelte(), federation(federationConfig)],
  build: { target: 'chrome89' },
});
