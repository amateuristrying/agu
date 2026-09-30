# AGU hero

A dependency-free, responsive AGU site with a cursor-driven metal-human hero and a white editorial second screen.

## Local preview

From this directory, run `node scripts/serve.mjs` and open `http://127.0.0.1:4173`. This dependency-free preview server supports the byte-range requests needed for video seeking, like the production CDN.

The editable site is in `dist/index.html`, `dist/styles.css`, `dist/chapter.css`, and `dist/app.js`. No build step is needed.

## Head tracking

`dist/assets/metal-human-scrub.mp4` is the continuous left-to-right pass from 5.25–10 seconds of the original video. It is 1600 pixels wide, with a keyframe every six frames (250ms) and fast-start metadata. The optimized file is about 3.2 MB, down from 10.9 MB, at the same resolution. It loads only when the hero needs motion; direct second-screen visits and reduced-motion users keep the poster without downloading the video.

Pointer position maps through three calibrated time anchors in `app.js`. The animation eases toward the target, seeks to actual 24fps frames, and waits for the decoder's `seeked` event between requests. It stops requesting frames when settled or when the page is hidden. The head returns to centre when the pointer leaves.

On touch screens, touching or dragging horizontally across the hero turns the head. Reduced-motion users get a static centred head. The image poster covers initial loading and unavailable video.

## Second screen and transition

Discover AGU, Our perspective, and downward scrolling at the end of the hero open the second screen. Touch swipes and keyboard navigation work too. Longer screens can scroll normally before the chapter boundary. Back to the beginning (or an upward scroll at the top) returns to the hero. The `#understanding` URL opens the second screen directly and browser Back/Forward restore the appropriate screen.

The transition is inspired by the central-strip sequence in the [Codrops Team transition demo](https://page-transitions-astro-barba-gsap.crnacura.workers.dev/team/): a white horizontal band displays Artificial General Understanding, expands to cover the screen, and retracts upward. It takes about 780ms, using transforms for the full-screen surface and native Web Animations, with no third-party runtime, loading cursor, or artificial hold. Both screens are already in the document; navigation never waits for the video. Normal scrolling resumes immediately after the reveal. A short boundary-only guard prevents touchpad bounce from reopening the previous screen. Reduced-motion preferences switch screens immediately.

The bottom-right geometric study is a native SVG in black, white, and blue, inspired by the supplied `vector.mov` reference. Its circles, squares, and wireframes run on a seamless eight-second CSS loop, with a pause button. It pauses on the hero, during transitions, and when the browser tab is hidden; reduced-motion preferences show a static composition. The reference video itself is not needed in production.

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

All production assets are committed in `dist`. No dependencies, environment variables, or server runtime are required.
