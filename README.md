# AGU hero

A dependency-free, responsive hero built around the supplied metal-human footage.

## Local preview

From this directory, run `python3 -m http.server 4173 --directory dist` and open `http://localhost:4173`.

The editable site is in `dist/index.html`, `dist/styles.css`, and `dist/app.js`. No build step is needed.

## Head tracking

`dist/assets/metal-human-scrub.mp4` is the continuous left-to-right pass from 5.25–10 seconds of the original video. It is resized to 1600 pixels wide and encoded with every frame as a keyframe for responsive bidirectional seeking.

Pointer position maps through three calibrated time anchors in `app.js`. The animation eases toward the target and serializes video seeks. It stops requesting frames when settled or when the page is hidden. The head returns to centre when the pointer leaves.

On touch screens, touching or dragging across the hero turns the head. Reduced-motion users get a static centred head. The image poster covers initial loading and unavailable video. Both hero buttons open the same accessible native dialog; Escape closes it.

## Asset regeneration

```sh
ffmpeg -ss 5.25 -i /path/to/metal-human.mp4 -t 4.75 -vf 'scale=1600:-2' -c:v libx264 -preset fast -crf 19 -g 1 -keyint_min 1 -bf 0 -an -movflags +faststart dist/assets/metal-human-scrub.mp4
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
