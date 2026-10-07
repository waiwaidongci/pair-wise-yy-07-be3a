import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5207,
  },
  build: {
    chunkSizeWarningLimit: 1200,
  },
});
