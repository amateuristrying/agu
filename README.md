# AGU

A responsive, three-chapter AGU site: a cursor-driven metal-human hero, a white editorial perspective screen, and an interactive retro product preview. It ships as static files with GSAP vendored locally; no build or package installation is required.

## Local preview

From this directory, run `node scripts/serve.mjs` and open `http://127.0.0.1:4173`. This dependency-free preview server supports the byte-range requests needed for video seeking, like the production CDN.

The editable site is in `dist/index.html`, the three CSS files, `dist/app.js` (navigation), `dist/head-tracking.js` (media lifecycle), and `dist/console.js` (product preview). No build step is needed.

## Head tracking

`dist/assets/metal-human-scrub.mp4` is the continuous left-to-right pass from 5.25–10 seconds of the original video. It is 1600 pixels wide, with a keyframe every six frames (250ms) and fast-start metadata. The optimized file is about 3.2 MB, down from 10.9 MB, at the same resolution. It loads only when the hero needs motion; direct second- or third-screen visits and reduced-motion users keep the poster without downloading the video.

Phones use a separate 960px-wide, 1.18 MB video (63% smaller than the desktop file). The chosen compressed video is fetched once into a memory-backed Blob URL so cursor scrubbing and returning to the hero do not depend on additional network range requests. Native loading remains a fallback if fetching fails.

Pointer position maps through three calibrated time anchors in `head-tracking.js`. The animation eases toward the target and seeks to actual 24fps frames. Persistent media listeners and a bounded seek watchdog recover stalled decoders, including when a seek event is missed or the page has been hidden. Chapter entry, tab visibility and browser page restoration resume the controller. It stops requesting frames when settled, outside the hero or in a hidden tab. The head returns to centre when the pointer leaves.

On touch screens, touching or dragging horizontally across the hero turns the head. Reduced-motion users get a static centred head. The image poster covers initial loading and unavailable video.

## Second screen and transition

Discover AGU, Our perspective, and downward scrolling at the end of the hero open the second screen. Touch swipes and keyboard navigation work too. Longer screens can scroll normally before the chapter boundary. Back to the beginning (or an upward scroll at the top) returns to the hero. The `#understanding` URL opens the second screen directly and browser Back/Forward restore the appropriate screen.

The transition is inspired by the central-strip sequence in the [Codrops Team transition demo](https://page-transitions-astro-barba-gsap.crnacura.workers.dev/team/): a white horizontal band displays Artificial General Understanding, expands to cover the screen, and retracts upward. It takes about 1.18 seconds, using transforms for the full-screen surface and native Web Animations, with no loading cursor or artificial hold. All three screens are already in the document; navigation never waits for the video. Normal scrolling resumes immediately after the reveal. A short boundary-only guard prevents touchpad bounce from reopening the previous screen. Reduced-motion preferences switch screens immediately.

The bottom-right geometric study is a native SVG in black, white, and blue, inspired by the supplied `vector.mov` reference. Its circles, squares, and wireframes run on a seamless eight-second CSS loop, with a pause button. It pauses on the hero, during transitions, and when the browser tab is hidden; reduced-motion preferences show a static composition. The reference video itself is not needed in production.

## Third screen and retro preview

At the bottom of the perspective screen, scroll down or choose **Explore the full picture** to open `#capabilities`. Its headline introduces AGU's connected view of project resources, decisions and history. The retro desktop is contained within a white editorial page, with a maximum width of 1260px (1500px when expanded).

The reveal follows the expanding-strip and lifting-curtain geometry of the [Codrops Contact example](https://page-transitions-astro-barba-gsap.crnacura.workers.dev/contact), using local GSAP over 2.38 seconds. The blue mask expands to cover the entire viewport, holds for 80ms, then lifts to reveal the next screen; the covering and uncovering phases do not overlap. The implementation does not reload the page or fetch a new screen. Scroll up at the top, use Our perspective, or browser Back/Forward to navigate between chapters.

The console is an explicitly labelled **interactive preview** with illustrative Project Atlas data, not a live backend. Three preset queries update the summary, recommended next step and evidence pipeline. Timeline entries trace commits, source buttons explain connected resources, and memory tabs switch between working, episodic and semantic context. Minimize, expand and pause controls work. On phones, Overview / Sources / Memory tabs keep the workspace readable without horizontal page scrolling.

GSAP animates panel entrances, graph connections, evidence bars, the signal chart and query feedback. Ambient animation pauses when the workspace is offscreen, minimized, hidden, or left behind. Reduced-motion preferences bypass transitions and motion. GSAP 3.15.0 is included in `dist/vendor` with its original notice and a license reference.

## Verification

```sh
node --check dist/app.js
node --check dist/console.js
node --check dist/head-tracking.js
node scripts/test-head-tracking.mjs
```

The head regression checks cover chapter re-entry during a stalled seek, a missed `seeked` event, tab restoration, cached asset reuse, reduced motion, mobile source selection and fetch fallback. Browser checks cover the real video decoder, three-screen navigation and console interactions.

## Asset regeneration

```sh
ffmpeg -ss 5.25 -i /path/to/metal-human.mp4 -t 4.75 -vf 'scale=1600:-2' -c:v libx264 -preset slow -crf 22 -g 6 -keyint_min 6 -sc_threshold 0 -bf 0 -an -movflags +faststart dist/assets/metal-human-scrub.mp4
ffmpeg -ss 2.9 -i dist/assets/metal-human-scrub.mp4 -frames:v 1 -q:v 2 dist/assets/metal-human-poster.jpg
```

## Cloudflare Pages

Connect this repository and use these settings:

- Production branch: `main`
- Framework preset: `None`
- Build command: `exit 0`
- Build output directory: `dist`
- Root directory: leave blank (repository root)

All production assets are committed in `dist`. No dependency installation, environment variables, or server runtime are required.
