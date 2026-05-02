import './style.css';
import { createDriver } from './animation/driver';
import { loadSprites } from './assets/sprite-loader';
import { attachKeyboard } from './input/keyboard';
import { createRenderer } from './renderer/playfield';
import { createPreviewRenderer } from './renderer/preview';
import { createStore } from './store';
import type { State } from './core/state';

const CELL_SIZE = 48;
// Rows 7–8 are the overflow zone; non-empty cells there on a stable
// board mean the round is lost. The check matches `isLost` in the
// core, but it lives here because the UI overlay is the only consumer.
const OVERFLOW_ROW_MIN = 7;

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

function isGameOver(state: State): boolean {
  if (state.active !== null) return false;
  for (let row = OVERFLOW_ROW_MIN; row < state.board.length; row++) {
    for (let col = 0; col < state.board[row].length; col++) {
      if (state.board[row][col].kind !== 'empty') return true;
    }
  }
  return false;
}

async function main(): Promise<void> {
  const canvas = requireElement('playfield-canvas', HTMLCanvasElement);
  const previewCanvas = requireElement('preview-canvas', HTMLCanvasElement);
  const scoreEl = requireElement('score', HTMLElement);
  const gameOverEl = requireElement('game-over', HTMLElement);
  const gameOverScoreEl = requireElement('game-over-score', HTMLElement);

  const sprites = await loadSprites();
  const store = createStore(Date.now());
  const driver = createDriver(store);
  const renderer = createRenderer({
    canvas,
    sprites,
    cellSize: CELL_SIZE,
    getSnapshot: store.getSnapshot,
    getInFlight: driver.getInFlight,
  });
  const previewRenderer = createPreviewRenderer({
    canvas: previewCanvas,
    sprites,
    cellSize: CELL_SIZE,
    getSnapshot: store.getSnapshot,
    getInFlight: driver.getInFlight,
  });
  const keyboard = attachKeyboard(store);

  let gameOverShown = false;
  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    if (!gameOverShown) return;
    e.preventDefault();
    driver.reset();
    store.restart(Date.now());
  });

  let lastScore = -1;
  function frame(now: number): void {
    driver.tick(now);
    keyboard.tick();
    renderer.draw(now);
    previewRenderer.draw(now);
    const snapshot = store.getSnapshot();
    if (snapshot.score !== lastScore) {
      scoreEl.textContent = String(snapshot.score);
      lastScore = snapshot.score;
    }
    const lost = isGameOver(snapshot);
    if (lost !== gameOverShown) {
      gameOverShown = lost;
      gameOverEl.setAttribute('aria-hidden', lost ? 'false' : 'true');
      if (lost) {
        gameOverScoreEl.textContent = String(snapshot.score);
        // Reveal the element first so the browser paints it at
        // opacity: 0; the next frame triggers the CSS transition.
        gameOverEl.hidden = false;
        requestAnimationFrame(() => {
          gameOverEl.classList.add('is-visible');
        });
      } else {
        gameOverEl.classList.remove('is-visible');
        gameOverEl.hidden = true;
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
