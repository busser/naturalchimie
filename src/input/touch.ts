// Maps touch gestures on the play area to core Inputs per
// docs/09-responsive-layout.md. Gestures: horizontal drag = column
// shifts (1 column per cell-width of finger displacement), tap =
// rotate, downward flick = drop. A drag may transition into a drop
// when the finger accelerates downward past the velocity threshold.
// Only the first finger matters; extra fingers are ignored until the
// first touch ends.
//
// Cell size and the active piece's anchor column are read at
// touchstart. The drag is relative: the pair starts at its current
// column at touch-down and snaps to integer columns from there. Shifts
// are dispatched only as the snap target changes, so a steady finger
// produces no inputs.
//
// All inputs flow through `store.dispatch` using the same Input shape
// as keyboard.ts.
import type { Input } from '../core/state';
import type { LayoutModule } from '../layout';
import type { Store } from '../store';

export type Touch = {
  detach(): void;
};

const DEAD_ZONE_CELLS = 0.2;
const DROP_VELOCITY_CELLS_PER_SEC = 8;
const COLUMN_MIN = 0;
const COLUMN_MAX = 6;

type Classification = 'unclassified' | 'drag' | 'flick';

type Gesture = {
  identifier: number;
  startX: number;
  startY: number;
  cellSize: number;
  anchorColumn: number;
  // Rightmost column the active piece can occupy. Captured at
  // touchstart from the snapshot's orientation: a horizontal pair
  // anchored at column N spans N..N+1, so it clamps at 5; a vertical
  // pair or solo item clamps at 6. Re-reading mid-drag would risk
  // racing with rotates queued by the keyboard layer.
  maxColumn: number;
  // Tracks the column we have already steered to via dispatched
  // shifts. We diff against this rather than the live snapshot so
  // that buffered, not-yet-applied shifts don't get re-issued.
  lastColumn: number;
  classification: Classification;
  // Last sample for the instantaneous-velocity check that promotes a
  // gesture to a drop.
  lastY: number;
  lastTime: number;
};

export function attachTouch(
  store: Store,
  layout: LayoutModule,
  element: HTMLElement,
): Touch {
  let gesture: Gesture | null = null;

  function onTouchStart(e: TouchEvent): void {
    if (gesture !== null) return;
    const t = e.changedTouches[0];
    if (!t) return;
    e.preventDefault();
    const snapshot = store.getSnapshot();
    const active = snapshot.active;
    const anchorColumn = active?.column ?? 3;
    const maxColumn =
      active?.kind === 'pair' && active.orientation === 'horizontal'
        ? COLUMN_MAX - 1
        : COLUMN_MAX;
    gesture = {
      identifier: t.identifier,
      startX: t.clientX,
      startY: t.clientY,
      cellSize: layout.get().cellSize,
      anchorColumn,
      maxColumn,
      lastColumn: anchorColumn,
      classification: 'unclassified',
      lastY: t.clientY,
      lastTime: e.timeStamp,
    };
  }

  function onTouchMove(e: TouchEvent): void {
    if (gesture === null) return;
    const t = findTouch(e.changedTouches, gesture.identifier);
    if (!t) return;
    e.preventDefault();
    const dx = t.clientX - gesture.startX;
    const dy = t.clientY - gesture.startY;
    const cell = gesture.cellSize;
    const deadZonePx = DEAD_ZONE_CELLS * cell;

    if (gesture.classification === 'unclassified') {
      const ax = Math.abs(dx);
      const ay = Math.abs(dy);
      if (ax >= deadZonePx || ay >= deadZonePx) {
        // Downward motion (positive dy) flicks; horizontal motion
        // drags. Upward motion is treated as a flick too — it won't
        // pass the downward-velocity check, so it stays inert.
        gesture.classification = ax > ay ? 'drag' : 'flick';
      }
    }

    if (gesture.classification === 'drag') {
      const offset = Math.round(dx / cell);
      const target = clamp(
        gesture.anchorColumn + offset,
        COLUMN_MIN,
        gesture.maxColumn,
      );
      while (gesture.lastColumn < target) {
        store.dispatch({ kind: 'shift', direction: 'right' });
        gesture.lastColumn += 1;
      }
      while (gesture.lastColumn > target) {
        store.dispatch({ kind: 'shift', direction: 'left' });
        gesture.lastColumn -= 1;
      }
    }

    if (gesture.classification !== 'unclassified') {
      const dt = e.timeStamp - gesture.lastTime;
      if (dt > 0) {
        const dyRecent = t.clientY - gesture.lastY;
        const velocity = dyRecent / cell / (dt / 1000);
        if (velocity >= DROP_VELOCITY_CELLS_PER_SEC) {
          store.dispatch({ kind: 'drop' });
          gesture = null;
          return;
        }
      }
    }
    gesture.lastY = t.clientY;
    gesture.lastTime = e.timeStamp;
  }

  function onTouchEnd(e: TouchEvent): void {
    if (gesture === null) return;
    if (!findTouch(e.changedTouches, gesture.identifier)) return;
    e.preventDefault();
    if (gesture.classification === 'unclassified') {
      const input: Input = { kind: 'rotate' };
      store.dispatch(input);
    }
    gesture = null;
  }

  function onTouchCancel(e: TouchEvent): void {
    if (gesture === null) return;
    if (!findTouch(e.changedTouches, gesture.identifier)) return;
    gesture = null;
  }

  const opts: AddEventListenerOptions = { passive: false };
  element.addEventListener('touchstart', onTouchStart, opts);
  element.addEventListener('touchmove', onTouchMove, opts);
  element.addEventListener('touchend', onTouchEnd, opts);
  element.addEventListener('touchcancel', onTouchCancel, opts);

  return {
    detach() {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchCancel);
    },
  };
}

function findTouch(
  list: TouchList,
  identifier: number,
): globalThis.Touch | null {
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i];
    if (t.identifier === identifier) return t;
  }
  return null;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
