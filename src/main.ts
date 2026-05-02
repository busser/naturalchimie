import './style.css';
import { createInitialState } from './core/initial-state';
import { loadSprites } from './assets/sprite-loader';
import { createRenderer } from './renderer/playfield';

const CELL_SIZE = 48;

function requireElement<T extends HTMLElement>(
  id: string,
  ctor: new () => T,
): T {
  const el = document.getElementById(id);
  if (!(el instanceof ctor)) {
    throw new Error(`main: #${id} not found (or wrong type)`);
  }
  return el;
}

async function main(): Promise<void> {
  const canvas = requireElement('playfield-canvas', HTMLCanvasElement);

  const sprites = await loadSprites();
  const state = createInitialState();
  const renderer = createRenderer({
    canvas,
    sprites,
    cellSize: CELL_SIZE,
    getSnapshot: () => state,
  });
  renderer.start();
}

void main();
