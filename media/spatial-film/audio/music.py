"""Original score + UI sound effects for the Sellix POS spatial film, synthesized from scratch.

96 BPM, so bars (2.5 s) land on the film's scene cuts at 5, 20, 25, 30 and 35 s.
Timings of the taps, sale chime and printer match film.html.
Usage: python music.py out.wav   (needs numpy + scipy)
"""
import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
DUR = 40.0
N = int(SR * DUR)
BPM = 96
BEAT = 60 / BPM
BAR = BEAT * 4
rng = np.random.default_rng(20261005)
t_all = np.arange(N) / SR


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env_adsr(n, a, d, s, r, sustain_len):
    a, d, r = int(a * SR), int(d * SR), int(r * SR)
    s_len = max(0, int(sustain_len * SR) - a - d)
    e = np.concatenate([np.linspace(0, 1, a, endpoint=False), np.linspace(1, s, d, endpoint=False),
                        np.full(s_len, s), np.linspace(s, 0, r)])
    return e[:n] if len(e) >= n else np.pad(e, (0, n - len(e)))


def lp(x, f, order=2):
    return sosfilt(butter(order, min(f, SR / 2 - 100) / (SR / 2), "low", output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f / (SR / 2), "high", output="sos"), x)


def add(buf, sig, start):
    i = int(start * SR)
    if i >= len(buf):
        return
    sig = sig[: len(buf) - i]
    buf[i:i + len(sig)] += sig


def ramp(points):
    """Piecewise-linear automation over the whole film: [(time, value), ...]."""
    ts, vs = zip(*points)
    return np.interp(t_all, ts, vs)


L = np.zeros(N)
R = np.zeros(N)
drums = np.zeros(N)

# Am – F – C – G, one chord per bar.
CHORDS = [[57, 60, 64, 69], [53, 57, 60, 65], [55, 60, 64, 67], [55, 59, 62, 67]]
ROOTS = [45, 41, 48, 43]
n_bars = int(np.ceil(DUR / BAR))

# --- pad: detuned saws, slow filter that opens as the film builds ---
pad_l, pad_r = np.zeros(N), np.zeros(N)
for b in range(n_bars):
    start = b * BAR
    n = int((BAR + 1.2) * SR)
    tt = np.arange(n) / SR
    e = env_adsr(n, .6, .4, .8, 1.2, BAR)
    for note in CHORDS[b % 4]:
        for det, side in ((-0.09, 0), (0.0, 2), (0.09, 1)):
            f = midi(note + det)
            ph = rng.random()
            saw = 2 * ((f * tt + ph) % 1) - 1
            if side in (0, 2):
                add(pad_l, saw * e * .05, start)
            if side in (1, 2):
                add(pad_r, saw * e * .05, start)
cut = ramp([(0, 500), (5, 1400), (19, 1800), (20, 3200), (34, 3600), (36, 2400), (40, 900)])
# time-varying low-pass: filter in short blocks with the block's cutoff
def lp_auto(x, cutoff, block=2400):
    out = np.zeros_like(x)
    zi = None
    for i in range(0, len(x), block):
        sos = butter(2, cutoff[i] / (SR / 2), "low", output="sos")
        if zi is None:
            zi = np.zeros((sos.shape[0], 2))
        out[i:i + block], zi = sosfilt(sos, x[i:i + block], zi=zi)
    return out
pad_l, pad_r = lp_auto(pad_l, cut), lp_auto(pad_r, cut)

# --- sub bass: eighth-note pulse from the drop ---
bass = np.zeros(N)
for b in range(n_bars):
    for k in range(8):
        st = b * BAR + k * BEAT / 2
        if not (5 <= st < 35.6):
            continue
        n = int(BEAT / 2 * SR)
        tt = np.arange(n) / SR
        f = midi(ROOTS[b % 4] - 12 + (12 if k % 4 == 3 else 0))
        s = np.sin(2 * np.pi * f * tt) + .3 * np.sin(4 * np.pi * f * tt)
        add(bass, s * env_adsr(n, .005, .08, .6, .05, BEAT / 2 - .05) * .32, st)
bass = lp(bass, 900)

# --- arpeggio pluck, 16ths, from the insights section ---
arp = np.zeros(N)
pattern = [0, 1, 2, 3, 2, 1, 2, 3]
for b in range(n_bars):
    for k in range(16):
        st = b * BAR + k * BEAT / 4
        if not (19.9 <= st < 35):
            continue
        note = CHORDS[b % 4][pattern[k % 8]] + 12
        n = int(.3 * SR)
        tt = np.arange(n) / SR
        f = midi(note)
        s = (2 * ((f * tt) % 1) - 1) * np.exp(-tt * 14)
        add(arp, s * .07, st)
arp = lp(arp, 3800)
arp_l = arp + np.concatenate([np.zeros(int(BEAT * .75 * SR)), arp])[:N] * .35  # dotted-8th echo, left
arp_r = arp + np.concatenate([np.zeros(int(BEAT * .5 * SR)), arp])[:N] * .35

# --- drums ---
def kick():
    n = int(.45 * SR); tt = np.arange(n) / SR
    f = 45 + 110 * np.exp(-tt * 28)
    return np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt * 7) * .9

def hat(open_=False):
    n = int((.18 if open_ else .05) * SR); tt = np.arange(n) / SR
    return hp(rng.standard_normal(n), 7000) * np.exp(-tt * (18 if open_ else 70)) * .16

def clap():
    n = int(.25 * SR); tt = np.arange(n) / SR
    nz = sosfilt(butter(2, [900 / (SR / 2), 3000 / (SR / 2)], "band", output="sos"), rng.standard_normal(n))
    e = np.exp(-tt * 22) + .6 * np.exp(-np.maximum(tt - .012, 0) * 30) * (tt > .012)
    return nz * e * .35

kick_times = []
for b in range(n_bars):
    for k in range(4):
        st = b * BAR + k * BEAT
        if 5 <= st < 35.5 and not (17.5 <= st < 20):  # short breakdown before insights
            add(drums, kick(), st); kick_times.append(st)
        if 10 <= st < 35.5 and not (17.5 <= st < 20):
            add(drums, hat(), st + BEAT / 2)
        if 20 <= st < 35.5 and k in (1, 3):
            add(drums, clap(), st)
    if 25 <= b * BAR < 35:
        for k in range(16):
            add(drums, hat() * .5, b * BAR + k * BEAT / 4)

# sidechain pump on pad + arp from each kick
duck = np.ones(N)
for kt in kick_times:
    i = int(kt * SR); n = int(BEAT * .9 * SR)
    curve = 1 - .55 * np.exp(-np.arange(n) / SR * 9)
    duck[i:i + n] = np.minimum(duck[i:i + n], curve[: len(duck[i:i + n])])

# --- risers and impacts ---
fx = np.zeros(N)
def riser(start, length):
    n = int(length * SR); tt = np.arange(n) / SR
    nz = rng.standard_normal(n)
    out = np.zeros(n)
    for i in range(0, n, 1200):
        f = 300 + 7000 * (i / n) ** 2
        out[i:i + 1200] = sosfilt(butter(2, [f / (SR / 2), min(f * 1.6, 20000) / (SR / 2)], "band", output="sos"), nz[i:i + 1200])
    add(fx, out * (tt / length) ** 2 * .35, start)

def impact(start, gain=1.0):
    n = int(2.5 * SR); tt = np.arange(n) / SR
    boom = np.sin(2 * np.pi * np.cumsum(35 + 60 * np.exp(-tt * 6)) / SR) * np.exp(-tt * 2.2)
    noise = lp(rng.standard_normal(n), 1800) * np.exp(-tt * 5) * .3
    add(fx, (boom + noise) * .6 * gain, start)

riser(2.6, 2.4); impact(5.0)
riser(17.6, 2.4); impact(20.0, .6)
riser(33.6, 2.0); impact(35.6, 1.1)

# --- UI sound effects, synced to film.html ---
sfx = np.zeros(N)
def tick(start, pitch=2200, gain=.22):
    n = int(.08 * SR); tt = np.arange(n) / SR
    add(sfx, np.sin(2 * np.pi * pitch * tt) * np.exp(-tt * 70) * gain, start)

def whoosh(start, length=.6, gain=.12):
    n = int(length * SR); tt = np.arange(n) / SR
    nz = sosfilt(butter(2, [1500 / (SR / 2), 6000 / (SR / 2)], "band", output="sos"), rng.standard_normal(n))
    add(sfx, nz * np.sin(np.pi * tt / length) ** 2 * gain, start)

def chime(start):
    for i, note in enumerate([84, 88, 91]):
        n = int(1.6 * SR); tt = np.arange(n) / SR
        f = midi(note)
        s = (np.sin(2 * np.pi * f * tt) + .25 * np.sin(2 * np.pi * 2.01 * f * tt)) * np.exp(-tt * 3.2)
        add(sfx, s * .13, start + i * .07)

for i, at in enumerate([6.3, 7.0, 7.7, 8.4, 9.1, 9.8]):  # product taps → fly to cart
    tick(at, 2000 + i * 120); whoosh(at + .02, .55, .07); tick(at + .6, 3200, .1)
tick(10.25, 1700)                                          # Charge
whoosh(10.5, .9, .12)                                      # payment dialog lifts out
tick(11.85, 1900); tick(12.8, 1700)                        # ₱1,000 · Complete sale
chime(13.0)                                                # sale complete
whoosh(14.0, .8, .1)
# thermal printer: buzzing line feed while the receipt prints (15.1 – 17.9 s)
n = int(2.8 * SR); tt = np.arange(n) / SR
buzz = sosfilt(butter(2, [2500 / (SR / 2), 5500 / (SR / 2)], "band", output="sos"), rng.standard_normal(n))
buzz *= (.5 + .5 * np.sign(np.sin(2 * np.pi * 38 * tt))) * np.minimum(1, np.minimum(tt / .05, (2.8 - tt) / .1)) * .09
add(sfx, buzz, 15.1)
tick(17.95, 900, .2)                                       # paper cut
for at in (28.2, 29.8):                                    # offline / back online
    tick(at, 1300 if at < 29 else 2600, .16)

# --- mix ---
master = ramp([(0, 0), (.4, 1), (38.6, 1), (40, 0)])
pad_gain = ramp([(0, .9), (5, 1), (35.5, 1), (36, 1.15), (40, 1)])
mixL = (pad_l * pad_gain + arp_l * .9) * duck + bass + drums + fx + sfx * .9
mixR = (pad_r * pad_gain + arp_r * .9) * duck + bass + drums + fx + sfx * .9
# a touch of stereo room on the pad/fx
for ch, d in ((mixL, .021), (mixR, .029)):
    k = int(d * SR)
    ch[k:] += lp(ch[:-k], 3000) * .18
stereo = np.stack([mixL, mixR], axis=1) * master[:, None]
stereo = np.tanh(stereo * 1.1) / np.tanh(1.1)               # gentle limiter
stereo /= np.max(np.abs(stereo)) / .89

out = sys.argv[1] if len(sys.argv) > 1 else "music.wav"
with wave.open(out, "wb") as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR)
    w.writeframes((stereo * 32767).astype("<i2").tobytes())
print("wrote", out)
