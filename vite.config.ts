import { defineConfig, type Plugin } from 'vitest/config';
import { execSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';

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

const BUILD_VERSION = resolveBuildVersion();

export default defineConfig(({ command }) => ({
  define: {
    __BUILD_VERSION__: JSON.stringify(BUILD_VERSION),
  },
  plugins: [emitVersionJson(BUILD_VERSION)],
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
