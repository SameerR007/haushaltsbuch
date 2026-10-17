"""Score + sound design for the promo, synced to cues.json. Writes audio.wav (48 kHz stereo).

Style: minimal ambient bed. Warm, slow pads (Fmaj9, Am7, Bbmaj9, Csus) changing every ~6 s,
a handful of sparse felt-piano notes in a lot of reverb, and a faint sub. No drums, no
arpeggios. SFX are quiet UI taps, keys, soft swishes and two-tone confirmations.
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
rng = np.random.default_rng(11)


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


def sweep_filter(x, f0, f1, q=2.0, curve=1.0):
    """Time-varying band-pass (state-variable filter), centre sweeps f0 -> f1."""
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
        out[i] = band
    return out


def noise(d):
    return rng.standard_normal(int(SR * d))


def saw_add(freq, d, maxh=3000, phase_seed=None):
    t = tt(d)
    K = int(max(1, min(40, maxh // freq)))
    r = np.random.default_rng(phase_seed)
    return sum(np.sin(2 * np.pi * freq * k * t + r.uniform(0, 6.28)) / k for k in range(1, K + 1)) * 0.6


class Bus:
    def __init__(self):
        self.L = np.zeros(N + SR * 6)
        self.R = np.zeros(N + SR * 6)

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


keys, pads, sfx, verb = Bus(), Bus(), Bus(), Bus()


def send(x, t, gain, pan=0.0, wet=0.25, bus=None):
    (bus or sfx).add(x, t, gain, pan)
    verb.add(x, t, gain * wet, pan)


# ================= MUSIC =================
START, END = MARK["drop"], MARK["end"]
CHORD_LEN = (END - START) / round((END - START) / 5.7)  # ~5.7 s per chord, last change lands on END
print(f"{(END - START) / CHORD_LEN:.0f} chords of {CHORD_LEN:.2f}s")

# (pad voicing, sub note)
Fmaj9 = ([53, 57, 60, 64, 67], 41)
Am7 = ([52, 55, 57, 60, 64], 45)
Bbmaj9 = ([50, 53, 57, 60, 65], 46)
Csus = ([48, 53, 55, 60, 65], 36)
Dm9 = ([50, 53, 57, 60, 64], 38)
# chord, then the two sparse piano notes played over it
PROG = [(Fmaj9, 72, 69), (Am7, 72, 67), (Bbmaj9, 69, 65), (Csus, 67, 65), (Fmaj9, 69, 72), (Dm9, 69, 65), (Bbmaj9, 70, 69), (Csus, 67, 72)]


def pad_st(notes, d, cutoff=1100, att=2.0, rel=2.5):
    """Warm pad: softened saws plus a sine layer, slow attack and release, gentle stereo drift."""
    t = tt(d)
    L = np.zeros(len(t)); R = np.zeros(len(t))
    for j, m in enumerate(notes):
        L += saw_add(mtof(m - 0.05), d, 1800, phase_seed=j * 2) * 0.5 + np.sin(2 * np.pi * mtof(m) * t + j)
        R += saw_add(mtof(m + 0.05), d, 1800, phase_seed=j * 2 + 1) * 0.5 + np.sin(2 * np.pi * mtof(m + 0.03) * t + j * 2)
    breathe = 0.88 + 0.12 * np.sin(2 * np.pi * t / 7.0)
    e = adsr(d, att, 3.0, 0.9, rel) * breathe / (len(notes) * 2)
    return lp(L, cutoff) * e, lp(R, cutoff) * e


def sub(m, d, att=1.0, rel=2.0):
    return np.sin(2 * np.pi * mtof(m) * tt(d)) * adsr(d, att, 1, 1, rel)


def felt(m, d=4.0, vel=1.0):
    """Soft felt piano: slightly inharmonic partials, gentle hammer, dark top end."""
    t = tt(d)
    f = mtof(m)
    y = np.zeros_like(t)
    for k, a in enumerate([1.0, 0.32, 0.12, 0.05, 0.02], start=1):
        fk = f * k * np.sqrt(1 + 0.0004 * k * k)
        y += a * np.sin(2 * np.pi * fk * t) * np.exp(-t / (2.6 / k ** 0.8))
    y += lp(noise(d), 700) * np.exp(-t / 0.006) * 0.02
    y[: int(SR * 0.01)] *= np.linspace(0, 1, int(SR * 0.01))
    return lp(y, 1800) * vel


def piano(m, t, vel=0.5, pan=0.0, d=4.5, g=0.15):
    p = felt(m, d, vel)
    keys.add(p, t, g, pan=pan)
    verb.add(p, t, g * 1.1, pan=pan)


# intro: the first pad breathes in under the logo, two quiet notes
iL, iR = pad_st(Fmaj9[0], START + 3.0, cutoff=850, att=3.0, rel=3.0)
pads.add_st(iL, iR, 0.0, 0.8)
piano(72, 0.6, 0.45, pan=0.15)
piano(69, 2.6, 0.4, pan=-0.1)

# body: one chord every ~5.7 s, overlapping so the changes are seamless
n_chords = round((END - START) / CHORD_LEN)
for i in range(n_chords):
    t0 = START + i * CHORD_LEN
    (notes, root), n1, n2 = PROG[i % len(PROG)]
    L, R = pad_st(notes, CHORD_LEN + 2.8)
    pads.add_st(L, R, t0 - 0.6, 1.0)
    pads.add(sub(root, CHORD_LEN + 1.5), t0 - 0.3, 0.07)
    piano(n1, t0 + 0.2, 0.45, pan=(n1 - 68) / 18)
    piano(n2, t0 + CHORD_LEN / 2 + 0.2, 0.38, pan=(n2 - 68) / 18)

# end card: resolve to Fmaj9 with a slow rolled chord and a long tail
end_d = DUR - END + 2.0
L, R = pad_st(Fmaj9[0], end_d, cutoff=1200, att=1.0, rel=3.0)
pads.add_st(L, R, END - 0.4, 1.05)
pads.add(sub(41, end_d, att=0.8, rel=3.0), END - 0.2, 0.07)
for i, m in enumerate([53, 60, 64, 67, 72]):
    piano(m, END + 0.15 + i * 0.09, 0.42, pan=(m - 62) / 24, d=5.0, g=0.13)
piano(76, END + 2.2, 0.35, pan=0.1, d=4.0, g=0.12)


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
    c = rng.uniform(1500, 2400)
    y = bp(noise(d), c * 0.6, c * 1.4) * np.exp(-t / 0.005)
    y += np.sin(2 * np.pi * rng.uniform(110, 150) * t) * np.exp(-t / 0.014) * 0.5
    y2 = np.zeros_like(y)
    o = int(SR * rng.uniform(0.028, 0.04))  # key release
    y2[o:] = y[: len(y) - o] * 0.25
    return lp(y + y2, 5500)


def whoosh(d=0.8, f0=300, f1=1800, q=0.9):
    n = noise(d)
    e = np.sin(np.pi * np.linspace(0, 1, len(n))) ** 2
    return sweep_filter(n * e, f0, f1, q=q)


def air(d=1.0, f0=2500, f1=7000):
    n = noise(d)
    e = np.sin(np.pi * np.linspace(0, 1, len(n))) ** 1.5
    return sweep_filter(n * e, f0, f1, q=1.2)


def confirm(f1, f2, d=1.6):
    """Quiet two-tone confirmation, soft attack, no bell partials."""
    t = tt(d)
    y = np.zeros_like(t)
    for k, f in enumerate([f1, f2]):
        on = np.clip(t - k * 0.08, 0, None)
        e = np.where(t > k * 0.08, (1 - np.exp(-on / 0.012)) * np.exp(-on / 0.5), 0)
        y += (np.sin(2 * np.pi * f * t) + 0.06 * np.sin(4 * np.pi * f * t)) * e
    return lp(y, 3500) * 0.6


def card_in():
    d = 0.35
    t = tt(d)
    y = lp(noise(d), 800) * np.sin(np.pi * np.clip(t / 0.12, 0, 1)) ** 2 * np.exp(-t / 0.08)
    y += np.sin(2 * np.pi * 160 * t) * np.exp(-t / 0.03) * 0.3
    return y


def paper_soft():
    d = 0.5
    t = tt(d)
    y = bp(noise(d), 700, 3000) * (1 - np.exp(-t / 0.004)) * np.exp(-t / 0.05) * 0.5
    y += np.sin(2 * np.pi * 120 * t) * np.exp(-t / 0.05) * 0.35
    return y


def scan_tex(d):
    t = tt(d)
    e = np.clip(np.minimum(t / 0.25, (d - t) / 0.35), 0, 1)
    return sweep_filter(noise(d), 900, 2600, q=2.5) * 0.45 * e


def lock_snap():
    d = 0.3
    t = tt(d)
    a = bp(noise(d), 1800, 5000) * np.exp(-t / 0.003)
    b = np.zeros_like(a)
    o = int(SR * 0.028)
    b[o:] = a[: len(a) - o] * 0.7
    return a + b + np.sin(2 * np.pi * 170 * t) * np.exp(-t / 0.035) * 0.4


for c in CUES["cues"]:
    t0, ty = c["t"], c["type"]
    if ty == "pad_in":
        send(air(2.0, 1200, 4000), t0, 0.04, wet=0.8)
    elif ty == "shimmer":
        send(air(1.6, 3000, 8000), t0, 0.035, wet=0.9)
    elif ty == "whoosh_soft":
        send(whoosh(0.8), t0, 0.16, wet=0.4)
    elif ty == "key":
        g = 0.22 if c.get("ch") == " " else 0.27
        send(key_click(), t0 + rng.uniform(-0.006, 0.006), g, pan=rng.uniform(-0.12, 0.12), wet=0.05)
    elif ty == "send":
        send(whoosh(0.4, 900, 3500, q=1.0), t0, 0.13, pan=0.25, wet=0.25)
        send(tap(2600), t0, 0.16, wet=0.1)
    elif ty == "card":
        send(card_in(), t0, 0.4, wet=0.3)
    elif ty == "tick":
        send(tap(3000), t0, 0.12, pan=-0.15 + 0.03 * c["i"], wet=0.15)
    elif ty == "click":
        send(tap(3800, 1.2), t0, 0.24, wet=0.08)
        send(tap(3300, 0.7), t0 + 0.07, 0.13, wet=0.08)
    elif ty == "success":
        send(confirm(mtof(76), mtof(81)), t0, 0.2, wet=0.5)
    elif ty == "glide":
        send(whoosh(c["dur"] + 0.3, 300, 1400, q=0.8), t0, 0.14, pan=0.4, wet=0.35)
    elif ty == "paper":
        send(paper_soft(), t0, 0.35, wet=0.25)
    elif ty == "scan":
        send(scan_tex(c["dur"]), t0, 0.1, wet=0.4)
    elif ty == "chime":
        send(confirm(mtof(72), mtof(79)), t0, 0.18, wet=0.5)
    elif ty == "swipe":
        send(whoosh(0.5, 500, 2500, q=1.0), t0, 0.1, pan=0.3, wet=0.3)
    elif ty == "count":
        n = max(1, int(c["dur"] / 0.06))
        for k in range(n):
            send(tap(2800), t0 + k * 0.06, 0.04, pan=0.1, wet=0.05)
    elif ty == "data":
        n = max(1, int(c["dur"] / 0.06))
        for k in range(n):
            send(tap(rng.uniform(3200, 4800)), t0 + k * 0.06, 0.025, pan=rng.uniform(-0.3, 0.3), wet=0.05)
    elif ty == "seg":
        send(tap(2600), t0, 0.07, pan=-0.3 + c["i"] * 0.15, wet=0.2)
    elif ty == "soft_tick":
        send(tap(2800), t0, 0.1, wet=0.2)
    elif ty == "lock":
        send(lock_snap(), t0, 0.28, wet=0.25)
    elif ty == "chip":
        send(card_in(), t0, 0.28, pan=[-0.4, 0, 0.4][c["i"]], wet=0.3)
    elif ty == "end_swell":
        send(air(1.8, 800, 3000), t0 - 0.9, 0.06, wet=0.8)
    elif ty == "glint":
        send(air(0.9, 4000, 10000), t0, 0.035, pan=0.3, wet=0.6)
    else:
        print("unhandled cue", ty, file=sys.stderr)

# ================= REVERB + MIX =================
ir_len = int(SR * 3.0)
tir = np.arange(ir_len) / SR
irs = []
for pre in (0.02, 0.028):
    ir = rng.standard_normal(ir_len) * np.exp(-tir / 0.75)
    ir = lp(ir, 4500)
    ir[: int(SR * pre)] = 0
    irs.append(ir / np.sqrt(np.sum(ir ** 2)))
vL = signal.fftconvolve(verb.L, irs[0])[: len(verb.L)] * 0.6
vR = signal.fftconvolve(verb.R, irs[1])[: len(verb.R)] * 0.6

MUSIC = 0.4
L = (keys.L + pads.L) * MUSIC + sfx.L + vL
R = (keys.R + pads.R) * MUSIC + sfx.R + vR
L, R = hp(L, 35)[:N], hp(R, 35)[:N]

peak = max(np.max(np.abs(L)), np.max(np.abs(R)))
L /= peak / 1.15; R /= peak / 1.15
L = np.tanh(L) * 0.89; R = np.tanh(R) * 0.89
fade = int(SR * 1.5)
L[-fade:] *= np.linspace(1, 0, fade) ** 2; R[-fade:] *= np.linspace(1, 0, fade) ** 2
fi = int(SR * 0.05)
L[:fi] *= np.linspace(0, 1, fi); R[:fi] *= np.linspace(0, 1, fi)
st = np.stack([L, R], axis=1)
wavfile.write(os.path.join(HERE, "audio.wav"), SR, (st * 32767).astype(np.int16))
print("wrote audio.wav", f"{DUR:.2f}s")
