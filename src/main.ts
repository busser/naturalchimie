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
  const restartConfirmEl = requireElement('restart-confirm', HTMLElement);
  const restartButtonEl = requireElement('restart-button', HTMLButtonElement);
  const leaderboardButtonEl = requireElement(
    'leaderboard-button',
    HTMLButtonElement,
  );

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

  // Pause clock for the restart-confirm overlay. The frame loop feeds
  // `effectiveNow(now)` to the driver and renderers instead of the raw
  // requestAnimationFrame timestamp; while paused, that value is
  // frozen, so the driver's `now - startNow` doesn't advance and
  // animations resume in place when the overlay closes (per
  // docs/11-restart-and-leaderboard.md "Interaction with game state").
  let pausedAt: number | null = null;
  let pauseOffsetMs = 0;
  function effectiveNow(now: number): number {
    return (pausedAt ?? now) - pauseOffsetMs;
  }
  function isPausedFn(): boolean {
    return pausedAt !== null;
  }
  function pauseGame(now: number): void {
    if (pausedAt !== null) return;
    pausedAt = now;
  }
  function resumeGame(now: number): void {
    if (pausedAt === null) return;
    pauseOffsetMs += now - pausedAt;
    pausedAt = null;
  }

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
  const keyboard = attachKeyboard(store, isPausedFn);
  const touch = attachTouch(store, layout, playfieldEl, isPausedFn);

  let restartConfirmShown = false;
  function showRestartConfirm(): void {
    if (restartConfirmShown) return;
    restartConfirmShown = true;
    restartConfirmEl.setAttribute('aria-hidden', 'false');
    restartConfirmEl.hidden = false;
    requestAnimationFrame(() => {
      restartConfirmEl.classList.add('is-visible');
    });
    pauseGame(performance.now());
  }
  function hideRestartConfirm(): void {
    if (!restartConfirmShown) return;
    restartConfirmShown = false;
    restartConfirmEl.setAttribute('aria-hidden', 'true');
    restartConfirmEl.classList.remove('is-visible');
    restartConfirmEl.hidden = true;
    resumeGame(performance.now());
  }

  function restart(): void {
    // Clear before restart so the next spawn step (which will save
    // the fresh round) doesn't race against a stale key.
    if (storage) clearRun(storage);
    driver.reset();
    store.restart(Date.now());
    favicon.reset();
    hideGameOver();
    // Fresh round starts with a clean clock; drop any accrued pause
    // without going through resumeGame (no leftover offset to fold in).
    restartConfirmShown = false;
    restartConfirmEl.setAttribute('aria-hidden', 'true');
    restartConfirmEl.classList.remove('is-visible');
    restartConfirmEl.hidden = true;
    pausedAt = null;
    pauseOffsetMs = 0;
  }

  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    if (restartConfirmShown) {
      e.preventDefault();
      restart();
      return;
    }
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

  // R toggles the restart-confirm overlay; ESC cancels it. Per spec
  // these shortcuts are active during a round and on the game-over
  // screen (docs/11-restart-and-leaderboard.md).
  window.addEventListener('keydown', (e) => {
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      if (restartConfirmShown) hideRestartConfirm();
      else showRestartConfirm();
      return;
    }
    if (e.key === 'Escape' && restartConfirmShown) {
      e.preventDefault();
      hideRestartConfirm();
    }
  });

  restartButtonEl.addEventListener('click', () => {
    // Tapping the icon again is one of the spec's cancel paths.
    if (restartConfirmShown) hideRestartConfirm();
    else showRestartConfirm();
  });
  // Leaderboard button is a placeholder until the overlay exists.
  leaderboardButtonEl.addEventListener('click', () => {});

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

  // Restart-confirm overlay input. Mouse: clicking outside the panel
  // cancels (SPACE confirms via the keyboard branch). Touch: any
  // double-tap on the overlay confirms; a single tap outside the panel
  // cancels after the double-tap window elapses (so a player can still
  // upgrade their first outside-tap into a confirm).
  let lastRestartTapTime = -Infinity;
  let pendingRestartCancel: number | null = null;
  function clearPendingRestartCancel(): void {
    if (pendingRestartCancel !== null) {
      window.clearTimeout(pendingRestartCancel);
      pendingRestartCancel = null;
    }
  }
  restartConfirmEl.addEventListener('click', (e) => {
    if (!restartConfirmShown) return;
    // Clicks on the panel (e.target is a descendant) leave the
    // overlay open; only the dim-wash background dismisses.
    if (e.target === restartConfirmEl) hideRestartConfirm();
  });
  restartConfirmEl.addEventListener('touchstart', (e) => {
    e.stopPropagation();
  });
  restartConfirmEl.addEventListener('touchmove', (e) => {
    e.stopPropagation();
  });
  restartConfirmEl.addEventListener('touchcancel', (e) => {
    e.stopPropagation();
  });
  restartConfirmEl.addEventListener('touchend', (e) => {
    e.stopPropagation();
    if (!restartConfirmShown) return;
    e.preventDefault();
    const now = e.timeStamp;
    if (now - lastRestartTapTime <= DOUBLE_TAP_WINDOW_MS) {
      lastRestartTapTime = -Infinity;
      clearPendingRestartCancel();
      restart();
      return;
    }
    lastRestartTapTime = now;
    const target = e.target;
    const onPanel =
      target instanceof Element &&
      target.closest('.restart-confirm__panel') !== null;
    if (!onPanel) {
      clearPendingRestartCancel();
      pendingRestartCancel = window.setTimeout(() => {
        pendingRestartCancel = null;
        hideRestartConfirm();
      }, DOUBLE_TAP_WINDOW_MS);
    }
  });

  let lastScore = -1;
  let splashHidden = false;
  function frame(now: number): void {
    // `eff` freezes during a pause so the driver and renderers see
    // wall-clock time pause along with input (per
    // docs/11-restart-and-leaderboard.md "Interaction with game state").
    const eff = effectiveNow(now);
    driver.tick(eff);
    keyboard.tick();
    touch.tick();
    renderer.draw(eff);
    previewRenderer.draw(eff);
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
    const inFlight = driver.getInFlight(eff);
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
