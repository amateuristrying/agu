import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Regression coverage for the suspended/missing-seek-event failure, without
// loading a browser or depending on a real network/decoder in the test runner.
const source = await readFile(new URL('../dist/head-tracking.js', import.meta.url), 'utf8');
class Events {
  handlers = new Map();
  addEventListener(name, handler) { this.handlers.set(name, [...(this.handlers.get(name) || []), handler]); }
  emit(name, event = {}) { for (const handler of this.handlers.get(name) || []) handler(event); }
}
async function setup({ reduced = false, mobile = false, offline = false } = {}) {
  const video = new Events(), hero = new Events(), document = new Events(), window = new Events();
  const motion = Object.assign(new Events(), { matches: reduced });
  const frames = new Map(), timers = new Map();
  let clock = 0, id = 0, requests = 0, loads = 0, lastSource = '';
  Object.assign(video, {
    dataset: { src: 'desktop.mp4', mobileSrc: 'mobile.mp4' },
    duration: 4.75, readyState: 4, seeking: false, currentTime: 2.9, error: null,
    pause() {}, load() { loads++; this.error = null; },
  });
  Object.assign(hero, { clientWidth: 1000, getBoundingClientRect: () => ({ left:0, width:1000 }) });
  Object.assign(document, { hidden:false, querySelector: selector => selector === '#hero' ? hero : video });
  vm.runInNewContext(source, {
    document, window, performance: { now: () => clock }, AbortController,
    matchMedia: query => query.includes('reduced-motion') ? motion : { matches: query.includes('max-width') ? mobile : true },
    fetch: async url => { requests++; lastSource=url; if(offline) throw Error('offline'); return { ok:true, blob:async () => ({}) }; },
    URL: { createObjectURL: () => 'blob:cached-video' },
    requestAnimationFrame: callback => { frames.set(++id,callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
    setTimeout: (callback,delay) => { timers.set(++id,{callback,at:clock+delay}); return id; },
    clearTimeout: key => timers.delete(key),
  });
  const tick = async (ms=16) => {
    clock += ms;
    for(const [key,item] of [...timers]) if(item.at<=clock){ timers.delete(key); item.callback(); }
    const queued=[...frames.values()]; frames.clear(); queued.forEach(callback=>callback(clock));
    await Promise.resolve();
  };
  const aim = x => hero.emit('pointermove',{clientX:x,pointerType:'mouse',target:{closest:()=>null}});
  const start = async () => { window.aguHead.setActive(true); for(let i=0;i<8;i++) await Promise.resolve(); };
  return { video, document, window, motion, aim, tick, start, frames, timers, stats:()=>({requests,loads,lastSource}) };
}

const head=await setup(); await head.start();
assert.equal(head.stats().requests,1);
head.aim(950); for(let i=0;i<80;i++) await head.tick();
assert.ok(head.video.currentTime>4.3,'tracks toward the right');
head.video.seeking=true; head.aim(100); await head.tick();
head.window.aguHead.setActive(false);
assert.equal(head.frames.size,0,'leaving cancels frame work');
assert.equal(head.timers.size,0,'leaving cancels watchdog');
await head.start(); await head.tick(2000);
assert.ok(head.stats().loads>=2,'a suspended seek is recovered on re-entry');
head.video.seeking=false; // Intentionally omit seeked: the watchdog must recover.
for(let i=0;i<80;i++) await head.tick(32);
assert.ok(head.video.currentTime<1,'tracks left even when seeked was missed');
assert.equal(head.stats().requests,1,'return trips reuse the cached video');
head.document.hidden=true; head.document.emit('visibilitychange');
assert.equal(head.frames.size,0); assert.equal(head.timers.size,0);
head.document.hidden=false; head.document.emit('visibilitychange'); head.aim(900);
for(let i=0;i<80;i++) await head.tick(32);
assert.ok(head.video.currentTime>4,'resumes after tab visibility changes');

const staticHead=await setup({reduced:true}); await staticHead.start();
assert.equal(staticHead.stats().requests,0,'reduced motion skips video download');
const mobileHead=await setup({mobile:true}); await mobileHead.start();
assert.equal(mobileHead.stats().lastSource,'mobile.mp4','phones get the smaller asset');
const fallback=await setup({offline:true}); await fallback.start();
assert.equal(fallback.video.src,'desktop.mp4','native loading remains available when fetch fails');
console.log('Head tracking regression checks passed.');
