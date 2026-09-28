(() => {
  const hero = document.querySelector('#hero');
  const video = document.querySelector('#figure');
  const dialog = document.querySelector('#vision-dialog');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  // This is the continuous LEFT → FRONT → RIGHT pass from the supplied video.
  // Anchor times are relative to the 5.25-second in-point of the source.
  const poses = { left: 0.2, centre: 2.9, right: 4.65 };
  let target = 0.5;
  let position = 0.5;
  let raf = 0;
  let lastTick = 0;
  let ready = false;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const timeForPosition = (value) => value < 0.5
    ? poses.left + (poses.centre - poses.left) * (value * 2)
    : poses.centre + (poses.right - poses.centre) * ((value - 0.5) * 2);

  function render(now) {
    raf = 0;
    if (!ready || document.hidden || dialog.open) return;
    const elapsed = Math.min(now - (lastTick || now - 16.67), 50);
    lastTick = now;
    position = reducedMotion.matches ? target : position + (target - position) * (1 - Math.exp(-elapsed / 100));
    if (Math.abs(target - position) < 0.001) position = target;
    const nextTime = Math.min(timeForPosition(position), Math.max(0, video.duration - 0.06));
    // Serialize seeks so the decoder can present a frame before the next request.
    if (!video.seeking && Math.abs(video.currentTime - nextTime) > 0.018) video.currentTime = nextTime;
    if (position !== target || video.seeking || Math.abs(video.currentTime - nextTime) > 0.018) raf = requestAnimationFrame(render);
    else lastTick = 0;
  }

  function wake() { if (!raf && ready && !document.hidden) raf = requestAnimationFrame(render); }
  function aim(value) { target = clamp(value, 0, 1); wake(); }
  function configureInput() {
    if (reducedMotion.matches) aim(0.5);
  }

  video.addEventListener('loadeddata', () => {
    ready = true;
    video.pause();
    video.currentTime = timeForPosition(position);
    wake();
  }, { once: true });
  video.addEventListener('seeked', wake);
  video.addEventListener('error', () => { ready = false; cancelAnimationFrame(raf); raf = 0; }, { once: true });

  hero.addEventListener('pointermove', (event) => {
    if (reducedMotion.matches || !finePointer.matches || event.pointerType === 'touch' || dialog.open) return;
    const bounds = hero.getBoundingClientRect();
    aim((event.clientX - bounds.left) / bounds.width);
  });
  hero.addEventListener('pointerleave', () => { if (!reducedMotion.matches) aim(0.5); });
  hero.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'touch' && !reducedMotion.matches && !event.target.closest('button,a,input')) aim(event.clientX / hero.clientWidth);
  });
  hero.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch' && !reducedMotion.matches && !event.target.closest('button,a,input')) aim(event.clientX / hero.clientWidth);
  });

  document.querySelectorAll('[data-open-vision]').forEach(button => button.addEventListener('click', () => dialog.showModal()));
  document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
  document.querySelector('#experience-button').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
  });
  dialog.addEventListener('close', wake);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; lastTick = 0; }
    else wake();
  });
  reducedMotion.addEventListener('change', configureInput);
  configureInput();
})();
