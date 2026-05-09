import { defineConfig, type Plugin } from 'vitest/config';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';

// @ts-expect-error - .mjs script loaded for its build-time side effects.
import { resizeSprites } from './tools/resize-sprites.mjs';

const SPRITE_SCALE = 0.5;

function resolveBuildVersion(): string {
  const fromEnv = process.env.GITHUB_SHA ?? process.env.BUILD_VERSION;
  if (fromEnv) return fromEnv.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return `t${Date.now()}`;
  }
}

function emitVersionJson(version: string): Plugin {
  return {
    name: 'naturalchimie:emit-version-json',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({ version }) + '\n',
      });
    },
  };
}

// Vite copies public/sprites/ into dist/sprites/ during the build. After the
// bundle settles, downscale the PNGs and rewrite sprites.json so production
// payloads shrink (originals stay untouched in public/, so dev and the
// sprite-authoring tool keep using full-resolution art).
function resizeSpritesPlugin(scale: number, outDir: string): Plugin {
  return {
    name: 'naturalchimie:resize-sprites',
    apply: 'build',
    async closeBundle() {
      const dir = path.resolve(outDir, 'sprites');
      await resizeSprites({ dir, scale });
    },
  };
}

const BUILD_VERSION = resolveBuildVersion();

export default defineConfig(({ command }) => ({
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  plugins: [
    emitVersionJson(BUILD_VERSION),
    resizeSpritesPlugin(SPRITE_SCALE, 'dist'),
  ],
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
