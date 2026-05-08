declare const __BUILD_VERSION__: string;

// Webclips and Safari hold onto the deployed index.html long after the
// underlying bundle has changed, with no user-facing way to reload. We
// poll a tiny version.json on launch and on foregrounding, and force a
// cache-busted reload when the deployed version moves past the running
// one.

export function startVersionCheck(): void {
  if (import.meta.env.DEV) return;

  const running = __BUILD_VERSION__;
  let reloading = false;

  async function check(): Promise<void> {
    if (reloading) return;
    try {
      const url = `${import.meta.env.BASE_URL}version.json?ts=${Date.now()}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { version?: unknown };
      const remote = typeof body.version === 'string' ? body.version : null;
      if (!remote || remote === running) return;
      reloading = true;
      const next = new URL(window.location.href);
      next.searchParams.set('v', remote);
      window.location.replace(next.toString());
    } catch {
      // Offline or version.json missing: stay on the running version.
    }
  }

  void check();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void check();
  });
}
