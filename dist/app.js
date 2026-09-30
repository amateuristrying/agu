(() => {
  const hero = document.querySelector('#hero');
  const chapter = document.querySelector('#understanding');
  const capabilities = document.querySelector('#capabilities');
  const screens = { hero, understanding: chapter, capabilities };
  let contactTimeline = null;
  const overlay = document.querySelector('#page-transition');
  const transitionSurface = overlay.querySelector('.transition-surface');
  const transitionTitle = overlay.querySelector('.transition-title');
  const transitionWords = [...transitionTitle.querySelectorAll('b')];
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const motionAnimations = new Set();
  let screen = 'hero';
  let transitioning = false;
  let queuedScreen = null;
  let boundaryBlockedUntil = 0;

  // The first transition uses native transforms; the Contact reveal uses local GSAP.
  async function tween(element, keyframes, options = {}) {
    const end = keyframes[keyframes.length - 1];
    if (!reducedMotion.matches) {
      const animation = element.animate(keyframes, {
        duration: 240, easing: 'cubic-bezier(.65,0,.25,1)', fill: 'both', ...options,
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
    capabilities.hidden = next !== 'capabilities';
    document.body.dataset.screen = next;
    document.querySelector('meta[name="theme-color"]').content = next === 'hero' ? '#050505' : '#ffffff';
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    window.aguHead.setActive(next === 'hero' && !transitioning);
  }

  async function revealChapter() {
    const lines = [...chapter.querySelectorAll('.headline-line > span')];
    const details = chapter.querySelector('.manifesto-details');
    await Promise.all([
      ...lines.map((line, index) => tween(line, [
        { transform: 'translateY(115%)' }, { transform: 'translateY(0%)' },
      ], { duration: 450, delay: index * 25, easing: 'cubic-bezier(.16,1,.3,1)' })),
      tween(details, [{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'translateY(0)' }],
        { duration: 400, delay: 60, easing: 'cubic-bezier(.16,1,.3,1)' }),
    ]);
    [...lines, details].forEach(element => element.removeAttribute('style'));
  }

  async function contactReveal(next) {
    const incoming = screens[next];
    incoming.hidden = false;
    incoming.classList.add('contact-enter');
    incoming.style.setProperty('--curtain-clip', 'inset(0 0 0% 0)');
    if (!window.gsap) { setScreen(next); return; }
    await new Promise(resolve => {
      contactTimeline = gsap.timeline({ onComplete: resolve });
      contactTimeline.to(incoming, {
        clipPath: 'polygon(0% 100%,100% 100%,100% 0%,0% 0%)',
        duration: 1.15, ease: 'power3.inOut',
      }, 0).to(incoming, {
        '--curtain-clip': 'inset(0 0 100% 0)', duration: 1.15, ease: 'power3.inOut',
      }, .25).call(() => {
        if (next === 'capabilities') window.aguConsole.enter();
        if (next === 'understanding') revealChapter();
      }, null, .55);
    });
    setScreen(next);
  }

  async function navigate(next, { history: updateHistory = true } = {}) {
    if (transitioning) { if (!updateHistory) queuedScreen = next; return; }
    if (screen === next) return;
    transitioning = true;
    document.body.classList.add('is-transitioning');
    Object.values(screens).forEach(page => page.inert = true);
    window.aguHead.setActive(false);
    window.aguConsole.leave();
    if (updateHistory) {
      history.pushState({ screen: next }, '', next === 'hero' ? location.pathname + location.search : `#${next}`);
    }
    try {
      if (reducedMotion.matches) {
        setScreen(next);
        if (next === 'capabilities') window.aguConsole.enter();
      } else if (next === 'capabilities' || screen === 'capabilities') {
        await contactReveal(next);
      } else {
        overlay.hidden = false;
        transitionWords.forEach(word => word.style.transform = 'translateY(0%)');
        const bandScale = Math.min(1, (transitionTitle.getBoundingClientRect().height + 18) / window.innerHeight);
        // Transform one white surface instead of repainting a fullscreen clip.
        // Both chapters already exist locally; navigation never waits on media.
        await Promise.all([
          tween(transitionSurface, [{ transform: `scale(0, ${bandScale})` }, { transform: `scale(1, ${bandScale})` }], { duration: 300 }),
          tween(transitionTitle, [{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)' }], { duration: 300 }),
        ]);
        await tween(transitionSurface, [{ transform: `scale(1, ${bandScale})` }, { transform: 'scale(1, 1)' }], { duration: 380 });
        setScreen(next);
        // Words lift out while the full white layer retracts towards the top.
        await Promise.all([
          ...transitionWords.map((word, index) => tween(word, [
            { transform: 'translateY(0%)' }, { transform: 'translateY(-115%)' },
          ], { duration: 260, delay: index * 30, easing: 'cubic-bezier(.65,0,.35,1)' })),
          tween(overlay, [{ transform: 'translateY(0%)' }, { transform: 'translateY(-100%)' }],
            { duration: 500, easing: 'cubic-bezier(.65,0,.25,1)' }),
          next === 'understanding' ? revealChapter() : Promise.resolve(),
        ]);
      }
    } finally {
      // Always release navigation, even when an animation is interrupted.
      if (screen !== next) setScreen(next);
      overlay.hidden = true;
      overlay.removeAttribute('style');
      transitionSurface.removeAttribute('style');
      transitionTitle.removeAttribute('style');
      transitionWords.forEach(word => word.removeAttribute('style'));
      Object.values(screens).forEach(page => {
        page.inert = false;
        page.classList.remove('contact-enter');
        page.style.removeProperty('clip-path');
        page.style.removeProperty('--curtain-clip');
      });
      contactTimeline?.kill(); contactTimeline = null;
      document.body.classList.remove('is-transitioning');
      transitioning = false;
      // Suppress only a bounce into the previous chapter, never normal scrolling.
      boundaryBlockedUntil = performance.now() + 200;
      document.querySelector(`#${next}-title`).focus({ preventScroll: true });
      window.aguHead.setActive(next === 'hero');
      if (queuedScreen) {
        const queued = queuedScreen;
        queuedScreen = null;
        if (queued !== screen) navigate(queued, { history: false });
      }
    }
  }

  document.querySelectorAll('[data-open-capabilities]').forEach(button => button.addEventListener('click', () => navigate('capabilities')));
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
    if (screen === 'understanding' && delta > 0 && atBottom()) return 'capabilities';
    if (screen === 'capabilities' && delta < 0 && atTop()) return 'understanding';
    return null;
  }
  let wheelTotal = 0;
  let lastWheel = 0;
  window.addEventListener('wheel', event => {
    if (event.ctrlKey) return;
    if (transitioning) { event.preventDefault(); return; }
    if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
    const destination = boundaryDestination(event.deltaY);
    if (!destination) { wheelTotal = 0; return; }
    event.preventDefault();
    const now = performance.now();
    if (now < boundaryBlockedUntil) return;
    if (now - lastWheel > 180) wheelTotal = 0;
    lastWheel = now;
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    wheelTotal += Math.abs(event.deltaY) * factor;
    if (wheelTotal >= 12) { wheelTotal = 0; navigate(destination); }
  }, { passive: false });

  let touchStart = null;
  window.addEventListener('touchstart', event => {
    if (event.touches.length !== 1 || event.target.closest('a,button,input,select,textarea')) { touchStart = null; return; }
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
    if (transitioning || Math.abs(deltaY) < 50 || Math.abs(deltaY) < Math.abs(deltaX)) return;
    const destination = boundaryDestination(deltaY);
    if (destination && performance.now() >= boundaryBlockedUntil) navigate(destination);
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
    if (document.hidden) {
      motionAnimations.forEach(animation => animation.finish());
      contactTimeline?.progress(1);
    }
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      motionAnimations.forEach(animation => animation.finish());
      contactTimeline?.progress(1);
    }
  });
  const routeScreen = () => ({ '#understanding': 'understanding', '#capabilities': 'capabilities' }[location.hash] || 'hero');
  window.addEventListener('popstate', () => navigate(routeScreen(), { history: false }));
  history.scrollRestoration = 'manual';
  setScreen(routeScreen());
  if (screen === 'capabilities') window.aguConsole.enter();
})();
