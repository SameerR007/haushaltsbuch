"""Score + sound design for the promo, synced to cues.json. Writes audio.wav (48 kHz stereo).

Style: calm, cinematic product film. Warm minor-key pads, a dark low synth pulse, sub bass,
half-time drums, a felt-piano breakdown resolving to Fmaj9 on the end card. SFX are quiet UI
taps, keys, airy whooshes and low hits, with no pitched blips or bells.
"""
import json, os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
CUES = json.load(open(os.path.join(HERE, "cues.json")))
DUR = CUES["total"]
MARK = CUES["marks"]
N = int(SR * DUR)
rng = np.random.default_rng(7)


# ---------------- helpers ----------------
def mtof(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def tt(d):
    return np.arange(int(SR * d)) / SR


def adsr(d, a, dcy, s, r):
    t = tt(d)
    e = np.where(t < a, t / max(a, 1e-6), s + (1 - s) * np.exp(-(t - a) / max(dcy, 1e-6)))
    rn = int(SR * r)
    if 0 < rn < len(e):
        e[-rn:] *= np.linspace(1, 0, rn) ** 2
    return e


def bp(x, lo, hi, order=2):
    sos = signal.butter(order, [lo, min(hi, SR / 2 - 100)], btype="band", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def lp(x, f, order=2):
    sos = signal.butter(order, min(f, SR / 2 - 100), btype="low", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def hp(x, f, order=2):
    sos = signal.butter(order, f, btype="high", fs=SR, output="sos")
    return signal.sosfilt(sos, x)


def sweep_filter(x, f0, f1, q=2.0, kind="band", curve=1.0):
    """Time-varying state-variable filter, cutoff sweeps f0 -> f1."""
    n = len(x)
    fc = f0 * (f1 / f0) ** (np.linspace(0, 1, n) ** curve)
    f = 2 * np.sin(np.pi * np.clip(fc, 20, SR / 6) / SR)
    damp = 1.0 / q
    low = band = 0.0
    out = np.empty(n)
    for i in range(n):
        h = x[i] - low - damp * band
        band += f[i] * h
        low += f[i] * band
        out[i] = band if kind == "band" else low
    return out


def noise(d):
    return rng.standard_normal(int(SR * d))


def saw_add(freq, d, maxh=3500, phase_seed=None):
    t = tt(d)
    K = int(max(1, min(40, maxh // freq)))
    r = np.random.default_rng(phase_seed)
    return sum(np.sin(2 * np.pi * freq * k * t + r.uniform(0, 6.28)) / k for k in range(1, K + 1)) * 0.6


class Bus:
    def __init__(self):
        self.L = np.zeros(N + SR * 4)
        self.R = np.zeros(N + SR * 4)

    def add(self, x, t, gain=1.0, pan=0.0):
        i = int(round(t * SR))
        if i < 0:
            x, i = x[-i:], 0
        n = min(len(x), len(self.L) - i)
        if n <= 0:
            return
        self.L[i : i + n] += x[:n] * gain * np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
        self.R[i : i + n] += x[:n] * gain * np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)

    def add_st(self, l, r, t, gain=1.0):
        i = int(round(t * SR))
        n = min(len(l), len(self.L) - i)
        self.L[i : i + n] += l[:n] * gain
        self.R[i : i + n] += r[:n] * gain


drums, keys, ducked, sfx, verb = Bus(), Bus(), Bus(), Bus(), Bus()


def send(x, t, gain, pan=0.0, wet=0.25, bus=None):
    (bus or sfx).add(x, t, gain, pan)
    verb.add(x, t, gain * wet, pan)


# ================= MUSIC =================
DROP, BREAK, END = MARK["drop"], MARK["breakdown"], MARK["end"]
BARS = round((END - DROP) / 2.4)
BAR = (END - DROP) / BARS          # ~2.42 s  (~99 BPM)
BEAT = BAR / 4
BREAK_BAR = round((BREAK - DROP) / BAR)
DRUMS_BAR = 2                      # full drums once the app is on screen
print(f"tempo {240 / BAR:.1f} BPM, {BARS} bars, breakdown at bar {BREAK_BAR}")

# chords: (pad voicing, bass root)
Dm9 = ([50, 53, 57, 60, 64], 38)
Bbmaj9 = ([50, 53, 57, 60, 65], 34)
F69 = ([48, 53, 57, 62, 67], 41)
CE = ([48, 52, 55, 62, 67], 40)
Gm9 = ([46, 50, 53, 57, 62], 43)
Csus = ([48, 53, 55, 60, 65], 36)
Fmaj9 = ([53, 57, 60, 64, 67], 41)
PROG = [Dm9, Dm9, Bbmaj9, Bbmaj9, F69, F69, CE, CE, Dm9, Dm9, Bbmaj9, Bbmaj9, Gm9, Gm9]  # main bars
BREAK_PROG = [Bbmaj9, Bbmaj9, Csus]


def chord_at(bar):
    if bar < BREAK_BAR:
        return PROG[min(bar, len(PROG) - 1)]
    return BREAK_PROG[min(bar - BREAK_BAR, len(BREAK_PROG) - 1)]


def pad_st(notes, d, cutoff=1200, att=0.7, rel=0.9):
    L = np.zeros(int(SR * d)); R = np.zeros(int(SR * d))
    for j, m in enumerate(notes):
        L += saw_add(mtof(m - 0.07), d, phase_seed=j * 2) + saw_add(mtof(m + 0.05), d, phase_seed=j * 2 + 100)
        R += saw_add(mtof(m + 0.07), d, phase_seed=j * 2 + 1) + saw_add(mtof(m - 0.05), d, phase_seed=j * 2 + 101)
    e = adsr(d, att, 2.0, 0.9, rel) / (len(notes) * 2)
    return lp(L, cutoff) * e, lp(R, cutoff) * e


def sub(m, d, att=0.05, rel=0.3):
    t = tt(d)
    y = np.sin(2 * np.pi * mtof(m) * t) + 0.12 * np.sin(4 * np.pi * mtof(m) * t)
    return np.tanh(y * 1.2) * adsr(d, att, 1, 1, rel)


def pulse_note(m, d, cutoff):
    y = lp(saw_add(mtof(m), d, 2500), cutoff, 2)
    return y * adsr(d, 0.004, 0.07, 0.15, 0.03)


def felt(m, d=3.0, vel=1.0):
    """Soft felt piano: slightly inharmonic partials, gentle hammer, dark."""
    t = tt(d)
    f = mtof(m)
    y = np.zeros_like(t)
    for k, a in enumerate([1.0, 0.42, 0.18, 0.1, 0.05, 0.03], start=1):
        fk = f * k * np.sqrt(1 + 0.0004 * k * k)
        y += a * np.sin(2 * np.pi * fk * t) * np.exp(-t / (1.8 / k ** 0.8))
    y += lp(noise(d), 1200) * np.exp(-t / 0.008) * 0.05
    y[: int(SR * 0.006)] *= np.linspace(0, 1, int(SR * 0.006))
    return lp(y, 2600) * vel


def kick(g=1.0):
    d = 0.6
    t = tt(d)
    f = 42 + 70 * np.exp(-t / 0.03)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.22)
    y += lp(noise(d), 4000) * np.exp(-t / 0.002) * 0.12
    return np.tanh(y * 1.3) * g


def snap():
    d = 0.4
    t = tt(d)
    y = bp(noise(d), 1400, 5000) * (np.exp(-t / 0.006) * 0.8 + np.exp(-t / 0.07) * 0.35)
    y += np.sin(2 * np.pi * 210 * t) * np.exp(-t / 0.02) * 0.3
    return y


def hat(g=1.0, open_=False):
    d = 0.25 if open_ else 0.06
    t = tt(d)
    return hp(noise(d), 8500, 4) * np.exp(-t / (0.07 if open_ else 0.012)) * g


kick_env = np.zeros(N + SR * 4)


def place_kick(t, g=1.0):
    k = kick(g)
    drums.add(k, t, 0.9)
    verb.add(k, t, 0.04)
    i = int(t * SR)
    e = np.exp(-tt(0.45) / 0.14) * g
    n = min(len(e), len(kick_env) - i)
    kick_env[i : i + n] = np.maximum(kick_env[i : i + n], e[:n])


# --- intro (0 -> DROP): dark drone that opens up, gone just before the drop
intro_d = DROP + 0.3
iL, iR = pad_st([38, 45, 50, 57], intro_d, cutoff=650, att=1.2, rel=0.6)
swell = np.linspace(0.35, 1.0, len(iL)) ** 1.5
cut = int(SR * (DROP - 0.65))
swell[cut:] *= np.linspace(1, 0, len(swell) - cut) ** 2
ducked.add_st(iL * swell, iR * swell, 0.0, 0.9)
ducked.add(sub(26, intro_d, att=1.0, rel=0.6) * swell, 0.0, 0.35)

# --- main + breakdown, bar by bar
for bar in range(BARS):
    t0 = DROP + bar * BAR
    notes, root = chord_at(bar)
    new_chord = bar == 0 or chord_at(bar - 1) != (notes, root)
    main = bar < BREAK_BAR
    if new_chord:
        span = 1
        while bar + span < BARS and chord_at(bar + span) == (notes, root):
            span += 1
        d = span * BAR
        L, R = pad_st(notes, d + 0.8, cutoff=1400 if main else 1100)
        ducked.add_st(L, R, t0, 0.95 if main else 1.15)
        ducked.add(sub(root, d + 0.1), t0, 0.42 if main else 0.32)
    # dark 16th pulse (main section only), filter opens over the logo bars
    if main:
        pat = [0, 0, 7, 0, 12, 0, 7, 0, 0, 0, 7, 0, 12, 7, 0, 0]
        for s in range(16):
            ts = t0 + s * BEAT / 4
            cutoff = 500 + 1300 * min(1.0, (ts - DROP) / (2 * BAR))
            acc = 1.0 if s % 4 == 0 else 0.6 if s % 2 == 0 else 0.45
            pn = pulse_note(root + 12 + pat[s], BEAT / 4 * 0.9, cutoff)
            ducked.add(pn, ts, 0.30 * acc, pan=(-0.25 if s % 2 else 0.25))
            verb.add(pn, ts, 0.05 * acc)
    # drums: half-time feel
    if main:
        place_kick(t0, 1.0)
        if bar >= DRUMS_BAR:
            place_kick(t0 + 2 * BEAT, 0.9)
            place_kick(t0 + 3.5 * BEAT, 0.45)
            sn = snap()
            drums.add(sn, t0 + 2 * BEAT, 0.32)
            verb.add(sn, t0 + 2 * BEAT, 0.16)
            for s in range(16):
                g = 0.16 if s % 4 == 2 else 0.07 if s % 2 == 0 else 0.045
                drums.add(hat(g), t0 + s * BEAT / 4, 1.0, pan=0.2)
            drums.add(hat(0.08, open_=True), t0 + 3.5 * BEAT, 1.0, pan=-0.2)
        else:
            place_kick(t0 + 2 * BEAT, 0.6)

# --- felt piano: breakdown motif, then the resolution on the end card
b0 = DROP + BREAK_BAR * BAR
MOTIF = [(0, 0, 74), (0, 1.5, 72), (0, 2, 69), (0, 3, 65),
         (1, 0, 77), (1, 1.5, 74), (1, 2, 72), (1, 3, 69),
         (2, 0, 67), (2, 1, 72), (2, 2, 65), (2, 3, 67)]
for bar_i, beat_i, m in MOTIF:
    tp = b0 + bar_i * BAR + beat_i * BEAT
    p = felt(m, 2.6, 0.9 if beat_i == 0 else 0.7)
    keys.add(p, tp, 0.16, pan=(m - 70) / 20)
    verb.add(p, tp, 0.12)
for m in [41, 53, 60, 64, 67, 69]:  # Fmaj9 chord on the end card
    p = felt(m, 5.0, 0.8)
    keys.add(p, END, 0.13, pan=(m - 58) / 30)
    verb.add(p, END, 0.10)
for i, m in enumerate([72, 69, 65]):
    tp = END + (1.5 + i * 1.2) * BEAT * 2
    p = felt(m, 3.0, 0.6)
    keys.add(p, tp, 0.11, pan=0.1)
    verb.add(p, tp, 0.1)

# end pad + sub, fading through the hold
end_d = DUR - END + 0.5
L, R = pad_st(Fmaj9[0], end_d, cutoff=1500, att=0.25, rel=2.2)
ducked.add_st(L, R, END, 1.1)
ducked.add(sub(29, end_d, att=0.02, rel=2.2), END, 0.4)
place_kick(END, 1.1)

# riser into the end card
rd = 1.4
rs = sweep_filter(noise(rd) * np.linspace(0, 1, int(SR * rd)) ** 2.5, 300, 6000, q=1.5, curve=1.4)
drums.add(rs, END - rd, 0.12)

# sidechain: pads, sub and pulse breathe with the kick
duck = 1 - 0.45 * kick_env
ducked.L *= duck; ducked.R *= duck


# ================= SFX =================
def tap(center=3200, g=1.0):
    d = 0.06
    t = tt(d)
    y = bp(noise(d), center * 0.6, center * 1.5) * np.exp(-t / 0.0035)
    y += np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.012) * 0.35
    return y * g


def key_click():
    d = 0.07
    t = tt(d)
    c = rng.uniform(1600, 2600)
    y = bp(noise(d), c * 0.6, c * 1.4) * np.exp(-t / 0.005)
    y += np.sin(2 * np.pi * rng.uniform(110, 150) * t) * np.exp(-t / 0.014) * 0.5
    y2 = np.zeros_like(y)
    o = int(SR * rng.uniform(0.028, 0.04))  # key release
    y2[o:] = y[: len(y) - o] * 0.25
    return lp(y + y2, 6000)


def thump(f0=55, f1=36, tau=0.25, d=0.8):
    t = tt(d)
    f = f1 + (f0 - f1) * np.exp(-t / 0.06)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / tau)
    y += lp(noise(d), 700) * np.exp(-t / 0.02) * 0.4
    return np.tanh(y * 1.4)


def boom(d=3.0):
    t = tt(d)
    f = 30 + 55 * np.exp(-t / 0.09)
    y = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.9)
    y += lp(noise(d), 500) * np.exp(-t / 0.15) * 0.45
    y += bp(noise(d), 2000, 7000) * np.exp(-t / 0.5) * 0.04
    return np.tanh(y * 1.5)


def riser(d):
    ramp = np.linspace(0, 1, int(SR * d))
    y = sweep_filter(noise(d) * ramp ** 2.2, 250, 7000, q=1.3, curve=1.4)
    y += hp(noise(d), 6000) * ramp ** 4 * 0.25  # reverse-cymbal air
    return y


def whoosh(d=0.6, f0=250, f1=2500, q=1.0):
    n = noise(d)
    e = np.sin(np.pi * np.linspace(0, 1, len(n))) ** 2
    return sweep_filter(n * e, f0, f1, q=q) * 1.2


def air(d=1.0, f0=3000, f1=9000):
    n = noise(d)
    e = np.sin(np.pi * np.linspace(0, 1, len(n))) ** 1.5
    return sweep_filter(n * e, f0, f1, q=1.2)


def confirm(f1, f2, d=1.4):
    """Quiet two-tone confirmation, soft attack, no bell partials."""
    t = tt(d)
    y = np.zeros_like(t)
    for k, f in enumerate([f1, f2]):
        on = t - k * 0.07
        e = np.where(on > 0, (1 - np.exp(-np.clip(on, 0, None) / 0.01)) * np.exp(-np.clip(on, 0, None) / 0.45), 0)
        y += (np.sin(2 * np.pi * f * t) + 0.08 * np.sin(4 * np.pi * f * t)) * e
    return lp(y, 4000) * 0.6


def card_in():
    d = 0.3
    t = tt(d)
    y = lp(noise(d), 900) * np.sin(np.pi * np.clip(t / 0.09, 0, 1)) ** 2 * np.exp(-t / 0.06)
    y += np.sin(2 * np.pi * 150 * t) * np.exp(-t / 0.035) * 0.5
    return y


def paper_land():
    d = 0.6
    t = tt(d)
    y = thump(70, 45, 0.12, d) * 0.8
    y += bp(noise(d), 900, 4000) * np.exp(-t / 0.04) * 0.3
    return y


def scan_tex(d):
    t = tt(d)
    e = np.clip(np.minimum(t / 0.15, (d - t) / 0.25), 0, 1)
    y = sweep_filter(noise(d), 700, 3200, q=3.5) * 0.55
    y += np.sin(2 * np.pi * 98 * t) * 0.12 * (0.6 + 0.4 * np.sin(2 * np.pi * 3 * t))
    return y * e


def lock_snap():
    d = 0.35
    t = tt(d)
    a = bp(noise(d), 2000, 6000) * np.exp(-t / 0.003)
    b = np.zeros_like(a)
    o = int(SR * 0.028)
    b[o:] = a[: len(a) - o] * 0.9
    body = np.sin(2 * np.pi * 160 * t) * np.exp(-t / 0.04) * 0.6 + np.sin(2 * np.pi * 1700 * t) * np.exp(-t / 0.03) * 0.06
    return a + b + body


for c in CUES["cues"]:
    t0, ty = c["t"], c["type"]
    if ty == "pop":
        send(tap(rng.uniform(2200, 4200)), t0, 0.2, pan=rng.uniform(-0.7, 0.7), wet=0.15)
    elif ty == "hit":
        send(thump(), t0, 0.55, wet=0.3)
        send(air(0.25, 1500, 4000), t0 - 0.12, 0.05, wet=0.2)
    elif ty == "impact":
        send(boom(2.2), t0, 0.75, wet=0.5)
    elif ty == "riser":
        send(riser(c["dur"]), t0, 0.32, wet=0.35)
    elif ty == "suck":
        d = c["dur"]
        send(sweep_filter(noise(d) * np.linspace(0, 1, int(SR * d)) ** 3, 200, 4000, q=1.4, curve=2), t0, 0.4, wet=0.25)
    elif ty == "boom":
        send(boom(), t0, 0.95, wet=0.6)
    elif ty == "shimmer":
        send(air(1.6, 2500, 7000), t0, 0.06, wet=0.8)
    elif ty == "whoosh":
        send(whoosh(0.7), t0, 0.32, wet=0.3)
    elif ty == "whoosh_big":
        send(whoosh(1.0, 120, 1800), t0, 0.45, wet=0.4)
    elif ty == "key":
        g = 0.26 if c.get("ch") == " " else 0.32
        send(key_click(), t0 + rng.uniform(-0.006, 0.006), g, pan=rng.uniform(-0.12, 0.12), wet=0.04)
    elif ty == "send":
        send(whoosh(0.35, 900, 4500, q=1.2), t0, 0.2, pan=0.25, wet=0.2)
        send(tap(2600), t0, 0.22, wet=0.1)
    elif ty == "card":
        send(card_in(), t0, 0.5, wet=0.25)
    elif ty == "tick":
        send(tap(3400), t0, 0.18, pan=-0.15 + 0.04 * c["i"], wet=0.15)
    elif ty == "click":
        send(tap(4200, 1.3), t0, 0.3, wet=0.08)
        send(tap(3600, 0.8), t0 + 0.07, 0.17, wet=0.08)
    elif ty == "success":
        send(confirm(mtof(77), mtof(84)), t0, 0.24, wet=0.45)
    elif ty == "fly":
        send(whoosh(c["dur"] + 0.25, 350, 2200, q=1.2), t0, 0.3, pan=0.45, wet=0.25)
    elif ty == "thud":
        send(paper_land(), t0, 0.6, wet=0.3)
    elif ty == "scan":
        send(scan_tex(c["dur"]), t0, 0.16, wet=0.35)
    elif ty == "chime":
        send(confirm(mtof(81), mtof(88)), t0, 0.22, wet=0.45)
    elif ty == "count":
        n = max(1, int(c["dur"] / 0.05))
        for k in range(n):
            send(tap(3000 + 40 * k), t0 + k * 0.05, 0.06, pan=0.1, wet=0.05)
    elif ty == "data":
        n = max(1, int(c["dur"] / 0.045))
        for k in range(n):
            send(tap(rng.uniform(3500, 5500)), t0 + k * 0.045, 0.035, pan=rng.uniform(-0.3, 0.3), wet=0.05)
    elif ty == "swipe":
        send(whoosh(0.45, 600, 3500, q=1.2), t0, 0.2, pan=0.35, wet=0.25)
    elif ty == "seg":
        send(tap(2800), t0, 0.1, pan=-0.3 + c["i"] * 0.12, wet=0.15)
    elif ty == "rise":
        d = 0.9
        send(sweep_filter(noise(d) * np.linspace(0, 1, int(SR * d)) ** 2, 300, 2500, q=1.3), t0 - 0.7, 0.2, wet=0.5)
    elif ty == "lock":
        send(lock_snap(), t0, 0.4, wet=0.2)
    elif ty == "chip":
        send(card_in(), t0, 0.35, pan=[-0.4, 0, 0.4][c["i"]], wet=0.25)
    elif ty == "soft_tick":
        send(tap(3000), t0, 0.14, wet=0.2)
    elif ty == "sting":
        send(boom(), t0, 0.6, wet=0.6)
    elif ty == "glint":
        send(air(0.7, 4000, 11000), t0, 0.05, pan=0.3, wet=0.5)
    elif ty in ("dots", "ding", "type_reveal"):
        pass  # deliberately silent
    else:
        print("unhandled cue", ty, file=sys.stderr)

# ================= REVERB + MIX =================
ir_len = int(SR * 2.6)
tir = np.arange(ir_len) / SR
irs = []
for pre in (0.018, 0.025):
    ir = rng.standard_normal(ir_len) * np.exp(-tir / 0.62)
    ir = lp(ir, 5000)
    ir[: int(SR * pre)] = 0
    irs.append(ir / np.sqrt(np.sum(ir ** 2)))
vL = signal.fftconvolve(verb.L, irs[0])[: len(verb.L)] * 0.55
vR = signal.fftconvolve(verb.R, irs[1])[: len(verb.R)] * 0.55

MUSIC = 0.5
L = (drums.L + keys.L + ducked.L) * MUSIC + sfx.L + vL
R = (drums.R + keys.R + ducked.R) * MUSIC + sfx.R + vR
L, R = hp(L, 28)[:N], hp(R, 28)[:N]

peak = max(np.max(np.abs(L)), np.max(np.abs(R)))
L /= peak / 1.2; R /= peak / 1.2
L = np.tanh(L) * 0.89; R = np.tanh(R) * 0.89
fade = int(SR * 1.2)
L[-fade:] *= np.linspace(1, 0, fade) ** 2; R[-fade:] *= np.linspace(1, 0, fade) ** 2
fi = int(SR * 0.02)
L[:fi] *= np.linspace(0, 1, fi); R[:fi] *= np.linspace(0, 1, fi)
st = np.stack([L, R], axis=1)
wavfile.write(os.path.join(HERE, "audio.wav"), SR, (st * 32767).astype(np.int16))
print("wrote audio.wav", f"{DUR:.2f}s")
