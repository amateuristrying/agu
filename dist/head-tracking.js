(() => {
  const hero = document.querySelector('#hero');
  const video = document.querySelector('#figure');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const poses = { left: .2, centre: 2.9, right: 4.65 };
  let active = false, target = .5, position = .5, raf = 0, timer = 0;
  let lastTick = 0, pendingSince = 0, loading = null, cachedURL = '', retries = 0;
  const timeAt = value => value < .5
    ? poses.left + (poses.centre - poses.left) * value * 2
    : poses.centre + (poses.right - poses.centre) * (value - .5) * 2;
  const enabled = () => active && !document.hidden && !reduced.matches;

  function cancel() {
    cancelAnimationFrame(raf); clearTimeout(timer);
    raf = timer = lastTick = 0;
    video.pause();
  }
  function wake() {
    if (enabled() && !raf) raf = requestAnimationFrame(render);
  }
  function checkAgain() {
    if (timer || !enabled()) return;
    timer = setTimeout(() => { timer = 0; wake(); }, 120);
  }
  function recover() {
    if (!cachedURL || retries >= 3 || !enabled()) return;
    retries++;
    pendingSince = performance.now();
    video.src = cachedURL;
    video.load();
    checkAgain();
  }
  async function ensureMedia() {
    if (cachedURL || loading || !enabled()) return;
    // Download once into memory: scrubbing and chapter re-entry no longer need
    // another network range request. Keep the small compressed file, not frames.
    const source = matchMedia('(max-width: 700px)').matches ? video.dataset.mobileSrc : video.dataset.src;
    loading = (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const response = await fetch(source, { signal: controller.signal, cache: 'force-cache' });
        if (!response.ok) throw new Error('Video unavailable');
        cachedURL = URL.createObjectURL(await response.blob());
      } catch {
        // Native media loading is a useful fallback on constrained connections.
        cachedURL = source;
      } finally { clearTimeout(timeout); }
      video.preload = 'auto';
      video.src = cachedURL;
      pendingSince = performance.now();
      video.load();
      wake();
    })();
    await loading;
    loading = null;
  }
  function render(now) {
    raf = 0;
    if (!enabled()) return;
    if (video.error || video.readyState < 2 || video.seeking) {
      if (!pendingSince) pendingSince = now;
      // A suspended decoder or missed seeked event must never strand the loop.
      if (cachedURL && now - pendingSince > 1800) recover();
      if (retries < 3 || !video.error) checkAgain();
      return;
    }
    pendingSince = 0;
    const elapsed = Math.min(now - (lastTick || now - 16.67), 64);
    lastTick = now;
    position += (target - position) * (1 - Math.exp(-elapsed / 85));
    if (Math.abs(target - position) < .002) position = target;
    const next = Math.min(Math.round(timeAt(position) * 24) / 24, video.duration - .06);
    if (Math.abs(video.currentTime - next) > .018) {
      try { video.currentTime = next; pendingSince = now; } catch { recover(); }
      checkAgain();
    } else if (position !== target) wake();
    else lastTick = 0;
  }
  function aim(value) { target = Math.min(1, Math.max(0, value)); ensureMedia(); wake(); }
  video.addEventListener('loadedmetadata', () => {
    video.pause();
    if (Number.isFinite(video.duration)) video.currentTime = Math.min(timeAt(position), video.duration - .06);
  });
  for (const event of ['loadeddata', 'canplay', 'seeked']) video.addEventListener(event, () => {
    pendingSince = 0; clearTimeout(timer); timer = 0; wake();
  });
  video.addEventListener('error', checkAgain);
  hero.addEventListener('pointermove', event => {
    if (!enabled() || (event.pointerType !== 'touch' && !fine.matches) || event.target.closest('a,button')) return;
    const bounds = hero.getBoundingClientRect();
    aim((event.clientX - bounds.left) / bounds.width);
  });
  hero.addEventListener('pointerdown', event => {
    if (enabled() && event.pointerType === 'touch' && !event.target.closest('a,button')) aim(event.clientX / hero.clientWidth);
  });
  hero.addEventListener('pointerleave', () => { if (enabled()) aim(.5); });
  function resume() {
    if (!enabled()) { cancel(); return; }
    retries = 0; lastTick = 0;
    ensureMedia();
    if (video.error) recover();
    wake();
  }
  document.addEventListener('visibilitychange', resume);
  window.addEventListener('pageshow', resume);
  window.addEventListener('online', resume);
  reduced.addEventListener('change', () => {
    if (reduced.matches) {
      cancel(); target = position = .5;
      if (video.readyState >= 1) video.currentTime = poses.centre;
    } else resume();
  });
  window.aguHead = {
    setActive(value) { active = value; if (value) resume(); else cancel(); },
  };
})();
