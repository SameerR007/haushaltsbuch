# Promo video source

The homepage promo (about 55 seconds) is generated from these files. Nothing here is used by the app.

Story: add expenses by chatting → review and confirm → or import a statement PDF → everything lands in the Expenses table → ask a question → see the month in Summary → your data stays on your computer. The same made-up household data runs through every scene, so the numbers match.

- `promo.html`: the animation. `T` holds the timeline in seconds, `render(t)` draws the frame at time `t`, and `CUES` lists the sound-effect times.
- `capture.js`: renders frames with Playwright (`npm i playwright-core`) and encodes `video.mp4`. It also writes `cues.json`.
- `synth.py`: synthesizes a minimal ambient bed (slow pads, sparse felt piano, no drums) and the UI sounds from `cues.json` into `audio.wav` (needs numpy and scipy). The tempo is fitted so the last chord lands on the end card.
- `mux.sh`: combines the two into the master and the web copy.
- `towebp.py`: turns the master into the silent animated preview at the top of the main README (`promo/preview.webp`, 960 px, 12 fps). It needs Pillow.

```bash
node capture.js stills 8.5,29.4     # preview single frames (seconds)
node capture.js video video.mp4
python3 synth.py
zsh mux.sh ../haushaltsbuch-promo.mp4 ../../public/home/demo.mp4
python3 towebp.py ../haushaltsbuch-promo.mp4 ../preview.webp 960 12 60
```

`capture.js` points at the Chrome for Testing build in `~/Library/Caches/ms-playwright`. Change `EXE` if yours is somewhere else.
