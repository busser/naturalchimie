import './style.css';
import { createDriver } from './animation/driver';
import { loadSprites } from './assets/sprite-loader';
import { createFavicon } from './favicon';
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

function hideSplash(): void {
  const splash = document.getElementById('splash');
  if (!splash) return;
  splash.addEventListener('transitionend', () => splash.remove(), {
    once: true,
  });
  splash.classList.add('is-loaded');
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

  // Set --cell and data-layout on the root before awaiting sprites,
  // so the first paint already matches the user's orientation rather
  // than flashing the default landscape rules during the load.
  const layout = createLayout();
  const sprites = await loadSprites();
  const store = createStore(Date.now());
  const favicon = createFavicon(sprites);

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
  const touch = attachTouch(store, layout, playfieldEl);

  function restart(): void {
    driver.reset();
    store.restart(Date.now());
    favicon.reset();
    hideGameOver();
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    if (gameOverShown) {
      e.preventDefault();
      restart();
      return;
    }
    if (import.meta.env.DEV) {
      e.preventDefault();
      store.randomizePreview();
    }
  });

  // Double-tap on the game-over overlay restarts, mirroring the SPACE
  // branch above. Two taps within 400 ms commit; the first tap arms the
  // window. stopPropagation keeps these touches out of the playfield's
  // touch handler so they don't open a phantom gesture under the
  // overlay (touchstart would otherwise bubble to .playfield).
  const DOUBLE_TAP_WINDOW_MS = 400;
  let lastTapTime = -Infinity;
  gameOverEl.addEventListener('touchstart', (e) => {
    e.stopPropagation();
  });
  gameOverEl.addEventListener('touchmove', (e) => {
    e.stopPropagation();
  });
  gameOverEl.addEventListener('touchcancel', (e) => {
    e.stopPropagation();
  });
  gameOverEl.addEventListener('touchend', (e) => {
    e.stopPropagation();
    if (!gameOverShown) return;
    e.preventDefault();
    const now = e.timeStamp;
    if (now - lastTapTime <= DOUBLE_TAP_WINDOW_MS) {
      lastTapTime = -Infinity;
      restart();
    } else {
      lastTapTime = now;
    }
  });

  let lastScore = -1;
  let splashHidden = false;
  function frame(now: number): void {
    driver.tick(now);
    keyboard.tick();
    touch.tick();
    renderer.draw(now);
    previewRenderer.draw(now);
    const snapshot = store.getSnapshot();
    if (snapshot.score !== lastScore) {
      scoreEl.textContent = String(snapshot.score);
      lastScore = snapshot.score;
    }
    favicon.update(snapshot);
    if (!splashHidden) {
      splashHidden = true;
      hideSplash();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

void main();
