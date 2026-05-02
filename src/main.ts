import './style.css';
import { createDriver } from './animation/driver';
import { loadSprites } from './assets/sprite-loader';
import { attachKeyboard } from './input/keyboard';
import { createRenderer } from './renderer/playfield';
import { createStore } from './store';

const CELL_SIZE = 48;
const RNG_SEED = 1;

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
  const scoreEl = requireElement('score', HTMLElement);

  const sprites = await loadSprites();
  const store = createStore(RNG_SEED);
  const driver = createDriver(store);
  const renderer = createRenderer({
    canvas,
    sprites,
    cellSize: CELL_SIZE,
    getSnapshot: store.getSnapshot,
    getInFlight: driver.getInFlight,
  });
  const keyboard = attachKeyboard(store);

  let lastScore = -1;
  function frame(now: number): void {
    driver.tick(now);
    keyboard.tick();
    renderer.draw(now);
    const score = store.getSnapshot().score;
    if (score !== lastScore) {
      scoreEl.textContent = String(score);
      lastScore = score;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
