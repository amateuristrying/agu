(() => {
  const hero = document.querySelector('#hero');
  const chapter = document.querySelector('#understanding');
  const video = document.querySelector('#figure');
  const overlay = document.querySelector('#page-transition');
  const transitionTitle = overlay.querySelector('.transition-title');
  const transitionWords = [...transitionTitle.querySelectorAll('b')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const motionAnimations = new Set();
  let screen = 'hero';
  let transitioning = false;
  let queuedScreen = null;
  let cooldownUntil = 0;

  // One continuous LEFT → FRONT → RIGHT pass, starting 5.25s into the source.
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
    if (!ready || document.hidden || transitioning || screen !== 'hero') return;
    const elapsed = Math.min(now - (lastTick || now - 16.67), 50);
    lastTick = now;
    position = reducedMotion.matches ? target : position + (target - position) * (1 - Math.exp(-elapsed / 100));
    if (Math.abs(target - position) < 0.001) position = target;
    const nextTime = Math.min(timeForPosition(position), Math.max(0, video.duration - 0.06));
    // Serialize seeks so the decoder can display each requested frame.
    if (!video.seeking && Math.abs(video.currentTime - nextTime) > 0.018) video.currentTime = nextTime;
    if (position !== target || video.seeking || Math.abs(video.currentTime - nextTime) > 0.018) raf = requestAnimationFrame(render);
    else lastTick = 0;
  }
  function wake() {
    if (!raf && ready && !document.hidden && !transitioning && screen === 'hero') raf = requestAnimationFrame(render);
  }
  function aim(value) { target = clamp(value, 0, 1); wake(); }
  video.addEventListener('loadeddata', () => {
    ready = true;
    video.pause();
    video.currentTime = timeForPosition(position);
    wake();
  }, { once: true });
  video.addEventListener('seeked', wake);
  video.addEventListener('error', () => { ready = false; cancelAnimationFrame(raf); raf = 0; }, { once: true });
  hero.addEventListener('pointermove', (event) => {
    if (reducedMotion.matches || !finePointer.matches || event.pointerType === 'touch' || transitioning) return;
    const bounds = hero.getBoundingClientRect();
    aim((event.clientX - bounds.left) / bounds.width);
  });
  hero.addEventListener('pointerleave', () => { if (!reducedMotion.matches) aim(0.5); });
  for (const eventName of ['pointerdown', 'pointermove']) {
    hero.addEventListener(eventName, (event) => {
      if (event.pointerType === 'touch' && !reducedMotion.matches && !transitioning && !event.target.closest('button,a,input')) {
        aim(event.clientX / hero.clientWidth);
      }
    });
  }

  // Native keyframes keep this static site independent of animation CDNs.
  async function tween(element, keyframes, options = {}) {
    const end = keyframes[keyframes.length - 1];
    if (!reducedMotion.matches) {
      const animation = element.animate(keyframes, {
        duration: 700, easing: 'cubic-bezier(.76,0,.24,1)', fill: 'both', ...options,
      });
      motionAnimations.add(animation);
      await animation.finished.catch(() => {});
      Object.assign(element.style, end);
      motionAnimations.delete(animation);
      animation.cancel();
    } else Object.assign(element.style, end);
  }

  function setScreen(next) {
    screen = next;
    hero.hidden = next !== 'hero';
    chapter.hidden = next !== 'understanding';
    document.body.dataset.screen = next;
    document.querySelector('meta[name="theme-color"]').content = next === 'hero' ? '#050505' : '#ffffff';
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }

  async function revealChapter() {
    const lines = [...chapter.querySelectorAll('.headline-line > span')];
    const details = chapter.querySelector('.manifesto-details');
    await Promise.all([
      ...lines.map((line, index) => tween(line, [
        { transform: 'translateY(115%)' }, { transform: 'translateY(0%)' },
      ], { duration: 850, delay: 160 + index * 75, easing: 'cubic-bezier(.16,1,.3,1)' })),
      tween(details, [{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 750, delay: 420, easing: 'cubic-bezier(.16,1,.3,1)' }),
    ]);
    [...lines, details].forEach(element => element.removeAttribute('style'));
  }

  async function navigate(next, { history: updateHistory = true } = {}) {
    if (transitioning) { if (!updateHistory) queuedScreen = next; return; }
    if (screen === next) return;
    transitioning = true;
    document.body.classList.add('is-transitioning');
    hero.inert = chapter.inert = true;
    cancelAnimationFrame(raf);
    raf = 0;
    lastTick = 0;
    if (updateHistory) {
      history.pushState({ screen: next }, '', next === 'understanding' ? '#understanding' : location.pathname + location.search);
    }
    try {
      if (reducedMotion.matches) {
        setScreen(next);
      } else {
        overlay.hidden = false;
        transitionWords.forEach(word => word.style.transform = 'translateY(0%)');
        const band = Math.ceil(transitionTitle.getBoundingClientRect().height / 2 + 9);
        const edge = `calc(50% - ${band}px)`;
        const stripStart = `inset(${edge} 100% ${edge} 0%)`;
        const stripFull = `inset(${edge} 0% ${edge} 0%)`;
        // A slim horizontal band crosses the old screen, then opens vertically.
        await tween(overlay, [{ clipPath: stripStart }, { clipPath: stripFull }], { duration: 800 });
        await tween(overlay, [{ clipPath: stripFull }, { clipPath: 'inset(0% 0% 0% 0%)' }], { duration: 800, delay: 160 });
        setScreen(next);
        // Words lift out while the full white layer retracts towards the top.
        await Promise.all([
          ...transitionWords.map((word, index) => tween(word, [
            { transform: 'translateY(0%)' }, { transform: 'translateY(-115%)' },
          ], { duration: 430, delay: index * 65, easing: 'cubic-bezier(.65,0,.35,1)' })),
          tween(overlay, [{ clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 100% 0%)' }],
            { duration: 900, delay: 230, easing: 'cubic-bezier(.76,0,.24,1)' }),
          next === 'understanding' ? revealChapter() : Promise.resolve(),
        ]);
      }
    } finally {
      // Always release navigation, even when an animation is interrupted.
      setScreen(next);
      overlay.hidden = true;
      overlay.removeAttribute('style');
      transitionWords.forEach(word => word.removeAttribute('style'));
      hero.inert = chapter.inert = false;
      document.body.classList.remove('is-transitioning');
      transitioning = false;
      cooldownUntil = performance.now() + 650;
      document.querySelector(next === 'hero' ? '#hero-title' : '#understanding-title').focus({ preventScroll: true });
      wake();
      if (queuedScreen) {
        const queued = queuedScreen;
        queuedScreen = null;
        if (queued !== screen) navigate(queued, { history: false });
      }
    }
  }

  document.querySelectorAll('[data-open-vision]').forEach(button => button.addEventListener('click', () => navigate('understanding')));
  document.querySelectorAll('[data-home]').forEach(link => link.addEventListener('click', event => {
    event.preventDefault();
    navigate('hero');
  }));

  // Intercept only an intentional gesture at a chapter boundary. Long screens
  // (including text zoom) still scroll normally within their own content.
  const atBottom = () => window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 3;
  const atTop = () => window.scrollY <= 3;
  function boundaryDestination(delta) {
    if (screen === 'hero' && delta > 0 && atBottom()) return 'understanding';
    if (screen === 'understanding' && delta < 0 && atTop()) return 'hero';
    return null;
  }
  let wheelTotal = 0;
  let lastWheel = 0;
  window.addEventListener('wheel', event => {
    if (event.ctrlKey) return;
    if (transitioning || performance.now() < cooldownUntil) { event.preventDefault(); return; }
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const destination = boundaryDestination(event.deltaY);
    if (!destination) { wheelTotal = 0; return; }
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheel > 180) wheelTotal = 0;
    lastWheel = now;
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    wheelTotal += Math.abs(event.deltaY) * factor;
    if (wheelTotal >= 45) { wheelTotal = 0; navigate(destination); }
  }, { passive: false });

  let touchStart = null;
  window.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || event.target.closest('a,button,input')) { touchStart = null; return; }
    touchStart = { x: event.touches[0].clientX, y: event.touches[0].clientY };
  }, { passive: true });
  window.addEventListener('touchmove', event => {
    if (transitioning) { event.preventDefault(); return; }
    if (!touchStart || event.touches.length !== 1) return;
    const delta = touchStart.y - event.touches[0].clientY;
    if (Math.abs(delta) > 12 && boundaryDestination(delta)) event.preventDefault();
  }, { passive: false });
  window.addEventListener('touchend', event => {
    if (!touchStart) return;
    const deltaY = touchStart.y - event.changedTouches[0].clientY;
    const deltaX = touchStart.x - event.changedTouches[0].clientX;
    touchStart = null;
    if (transitioning || performance.now() < cooldownUntil || Math.abs(deltaY) < 65 || Math.abs(deltaY) < Math.abs(deltaX)) return;
    const destination = boundaryDestination(deltaY);
    if (destination) navigate(destination);
  }, { passive: true });
  window.addEventListener('touchcancel', () => { touchStart = null; }, { passive: true });
  window.addEventListener('keydown', event => {
    if (event.target.closest('a,button,input,textarea,select') || event.ctrlKey || event.metaKey || event.altKey) return;
    const down = ['ArrowDown','PageDown','End'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
    const up = ['ArrowUp','PageUp','Home'].includes(event.key) || (event.key === ' ' && event.shiftKey);
    if (!down && !up) return;
    if (transitioning) { event.preventDefault(); return; }
    const destination = boundaryDestination(down ? 1 : -1);
    if (destination) { event.preventDefault(); navigate(destination); }
  });

  const motionToggle = document.querySelector('#motion-toggle');
  motionToggle.addEventListener('click', () => {
    const paused = document.querySelector('.vector-study').classList.toggle('is-paused');
    motionToggle.setAttribute('aria-pressed', String(paused));
    motionToggle.setAttribute('aria-label', paused ? 'Play geometric animation' : 'Pause geometric animation');
  });
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('page-hidden', document.hidden);
    if (document.hidden) { cancelAnimationFrame(raf); raf = 0; lastTick = 0; }
    else wake();
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      aim(0.5);
      motionAnimations.forEach(animation => animation.finish());
    }
  });
  window.addEventListener('popstate', () => navigate(location.hash === '#understanding' ? 'understanding' : 'hero', { history: false }));
  history.scrollRestoration = 'manual';
  setScreen(location.hash === '#understanding' ? 'understanding' : 'hero');
})();
