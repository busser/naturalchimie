import './style.css';
import { createDriver } from './animation/driver';
import { loadSprites } from './assets/sprite-loader';
import { attachKeyboard } from './input/keyboard';
import { attachTouch } from './input/touch';
import { createLayout } from './layout';
import { createRenderer } from './renderer/playfield';
import { createPreviewRenderer } from './renderer/preview';
import { createStore } from './store';

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
  const playfieldEl = canvas.parentElement;
  if (!(playfieldEl instanceof HTMLElement)) {
    throw new Error('main: #playfield-canvas has no parent element');
  }
  const previewCanvas = requireElement('preview-canvas', HTMLCanvasElement);
  const scoreEl = requireElement('score', HTMLElement);
  const gameOverEl = requireElement('game-over', HTMLElement);
  const gameOverScoreEl = requireElement('game-over-score', HTMLElement);

  const sprites = await loadSprites();
  const store = createStore(Date.now());
  const layout = createLayout();

  let gameOverShown = false;
  function showGameOver(score: number): void {
    if (gameOverShown) return;
    gameOverShown = true;
    gameOverScoreEl.textContent = String(score);
    gameOverEl.setAttribute('aria-hidden', 'false');
    // Reveal the element first so the browser paints it at
    // opacity: 0; the next frame triggers the CSS transition.
    gameOverEl.hidden = false;
    requestAnimationFrame(() => {
      gameOverEl.classList.add('is-visible');
    });
  }
  function hideGameOver(): void {
    if (!gameOverShown) return;
    gameOverShown = false;
    gameOverEl.setAttribute('aria-hidden', 'true');
    gameOverEl.classList.remove('is-visible');
    gameOverEl.hidden = true;
  }

  const driver = createDriver(store, (step) => {
    if (step.event.kind === 'game-over') {
      showGameOver(step.snapshot.score);
    }
  });
  const renderer = createRenderer({
    canvas,
    sprites,
    cellSize: layout.get().cellSize,
    getSnapshot: store.getSnapshot,
    getInFlight: driver.getInFlight,
  });
  const previewRenderer = createPreviewRenderer({
    canvas: previewCanvas,
    sprites,
    cellSize: layout.get().cellSize,
    getSnapshot: store.getSnapshot,
    getInFlight: driver.getInFlight,
  });
  layout.subscribe(({ cellSize }) => {
    renderer.resize(cellSize);
    previewRenderer.resize(cellSize);
  });
  const keyboard = attachKeyboard(store);
  attachTouch(store, layout, playfieldEl);

  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    if (gameOverShown) {
      e.preventDefault();
      driver.reset();
      store.restart(Date.now());
      hideGameOver();
      return;
    }
    if (import.meta.env.DEV) {
      e.preventDefault();
      store.randomizePreview();
    }
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
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
