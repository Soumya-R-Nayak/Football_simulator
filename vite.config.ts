import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: false,
  },
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['archive/**', 'node_modules/**'],
    environment: 'node',
    globals: true,
  },
} as any);
