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
import {
  clearRun,
  formatLocalTimestamp,
  loadRun,
  recordRunInLeaderboard,
  saveRun,
} from './store/persistence';
import { startVersionCheck } from './version-check';

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

// Some browsers (e.g. Safari in lockdown private mode) throw on the
// `localStorage` property read itself rather than only on subsequent
// operations. Return null in that case so the rest of the app can
// skip persistence entirely.
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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
  startVersionCheck();
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
  // localStorage may be unavailable (private browsing, disabled).
  // The persistence helpers all degrade silently to no-ops when the
  // Storage handle throws, but we also guard the access itself for
  // browsers that throw on the property read.
  const storage = safeLocalStorage();
  const resumeFrom = storage ? (loadRun(storage) ?? undefined) : undefined;
  const store = createStore(Date.now(), resumeFrom);
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

  // The spawn step commits the post-cascade stable board with a
  // freshly drawn active piece — the exact moment the spec wants to
  // snapshot (docs/10-persistence.md "When to save"). Game-over
  // clears the run key and records the leaderboard entry as a paired
  // operation so the next launch can never resume a finished run.
  const driver = createDriver(store, (step) => {
    if (step.event.kind === 'spawn') {
      if (storage) saveRun(storage, step.snapshot);
      return;
    }
    if (step.event.kind === 'game-over') {
      if (storage) {
        clearRun(storage);
        recordRunInLeaderboard(
          storage,
          step.snapshot,
          formatLocalTimestamp(new Date()),
        );
      }
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
    // Clear before restart so the next spawn step (which will save
    // the fresh round) doesn't race against a stale key.
    if (storage) clearRun(storage);
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

  if (import.meta.env.DEV) {
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'x' && e.key !== 'X') return;
      e.preventDefault();
      store.forceGameOver();
    });
  }

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
    // The core's `score` updates live on every step's snapshot, but
    // ticking the sidebar numeral that often is distracting. Only
    // refresh the display once the play area has just stabilized —
    // either the spawn step is animating in (the cascade just
    // settled and `snapshot.score` is the post-cascade value), or
    // the player already has control (initial state, idle between
    // drops). On game-over `active` stays null and no spawn step is
    // queued, so the sidebar holds the pre-drop value; the
    // game-over modal shows the final score separately above.
    const inFlight = driver.getInFlight(now);
    const settling = inFlight !== null && inFlight.step.event.kind === 'spawn';
    if (snapshot.score !== lastScore && (settling || snapshot.active !== null)) {
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
