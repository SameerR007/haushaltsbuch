# Promo video source

The homepage promo (about 51 seconds) is generated from these files. Nothing here is used by the app.

- `promo.html`: the animation. Scenes are laid out on a 30-second grid, and `SEG` stretches that grid into the real pacing (longer holds, quick cuts). `render(T)` draws the frame at output time `T`. `CUES` lists the sound-effect times, already mapped to output time.
- `capture.js`: renders frames with Playwright (`npm i playwright-core`) and encodes `video.mp4`. It also writes `cues.json`.
- `synth.py`: synthesizes the score and sound effects from `cues.json` into `audio.wav` (needs numpy and scipy). The tempo is fitted so the drop lands on the logo and the final chord lands on the end card.
- `mux.sh`: combines the two into the master and the web copy.

```bash
node capture.js stills 7.5,17.5     # preview single frames (output seconds)
node capture.js video video.mp4
python3 synth.py
zsh mux.sh ../haushaltsbuch-promo.mp4 ../../public/home/demo.mp4
```

`capture.js` points at the Chrome for Testing build in `~/Library/Caches/ms-playwright`. Change `EXE` if yours is somewhere else.
