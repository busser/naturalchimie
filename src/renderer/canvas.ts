// Shared helper for sizing a canvas to a CSS-pixel rectangle while
// honoring devicePixelRatio. Called both at renderer construction
// and on resize so cell-size changes propagate without dropping the
// 2D context. Setting canvas.width/height resets transform and
// imageSmoothing, so this re-applies them every call.

export function applyCanvasSize(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
): void {
  const dpr = window.devicePixelRatio ?? 1;
  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(cssHeight * dpr);
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}
