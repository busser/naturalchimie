import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig(({ command }) => ({
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        ...(command === 'serve' && {
          spriteTool: fileURLToPath(new URL('./tools/sprite-tool.html', import.meta.url)),
        }),
      },
    },
  },
  test: {
    // Core tests run in node; renderer/animation tests can opt into jsdom per-file.
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
  },
}));
