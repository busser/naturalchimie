// Derives the layout mode and cell size from the viewport, exposes
// them to the canvas renderers via subscribe(), and pushes them to
// CSS via custom properties on the root element so stylesheets can
// size regions in cell-units.
//
// Spec: docs/09-responsive-layout.md (cell formula, safe-area
// semantics, and the small-viewport-unit rule for the height term).

export type LayoutMode = 'portrait' | 'landscape';

export type Layout = {
  readonly mode: LayoutMode;
  readonly cellSize: number;
};

export type LayoutModule = {
  get(): Layout;
  subscribe(fn: (layout: Layout) => void): () => void;
};

// 7.4 = 7 grid columns + two 0.2-cell side gaps.
// 16 = 0.2 + 2.4 (top strip: 2-cell preview + 0.2-cell parchment
// padding above and below) + 0.2 + 13 (play area) + 0.2.
const WIDTH_DIVISOR = 7.4;
const HEIGHT_DIVISOR = 16;

export function createLayout(): LayoutModule {
  const probe = createProbe();
  let current = compute(probe);
  apply(current);

  const listeners = new Set<(layout: Layout) => void>();
  const onChange = (): void => {
    const next = compute(probe);
    if (next.mode === current.mode && next.cellSize === current.cellSize) {
      return;
    }
    current = next;
    apply(next);
    for (const fn of listeners) fn(next);
  };
  window.addEventListener('resize', onChange);
  window.addEventListener('orientationchange', onChange);

  return {
    get: () => current,
    subscribe(fn) {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
}

function compute(probe: HTMLElement): Layout {
  const vw = window.innerWidth;
  const vhRaw = window.innerHeight;
  // The probe's height resolves `100svh` (small viewport height); its
  // padding resolves the safe-area insets. innerHeight grows when the
  // mobile address bar hides, which would mid-play reflow the layout —
  // svh stays pinned to the smaller-viewport value.
  const probeRect = probe.getBoundingClientRect();
  const styles = getComputedStyle(probe);
  const safeTop = parseFloat(styles.paddingTop) || 0;
  const safeBottom = parseFloat(styles.paddingBottom) || 0;
  const vh = probeRect.height > 0 ? probeRect.height : vhRaw;
  const mode: LayoutMode = vw > vhRaw ? 'landscape' : 'portrait';
  const raw = Math.min(
    vw / WIDTH_DIVISOR,
    (vh - safeTop - safeBottom) / HEIGHT_DIVISOR,
  );
  const cellSize = Math.max(1, Math.floor(raw));
  return { mode, cellSize };
}

function apply(layout: Layout): void {
  const root = document.documentElement;
  root.style.setProperty('--cell', `${layout.cellSize}px`);
  root.dataset.layout = layout.mode;
}

function createProbe(): HTMLDivElement {
  const probe = document.createElement('div');
  const s = probe.style;
  s.position = 'fixed';
  s.top = '0';
  s.left = '0';
  s.width = '0';
  s.height = '100svh';
  s.boxSizing = 'border-box';
  s.paddingTop = 'env(safe-area-inset-top, 0px)';
  s.paddingBottom = 'env(safe-area-inset-bottom, 0px)';
  s.pointerEvents = 'none';
  s.visibility = 'hidden';
  probe.setAttribute('aria-hidden', 'true');
  document.body.appendChild(probe);
  return probe;
}
