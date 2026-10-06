"""Synthesizes the voiceover lines in voiceover.json with a Piper voice, fitting each to its window.

Usage: python voice.py MODEL.onnx   (needs piper-tts; writes vo/<id>.wav)
Spellings are adjusted for pronunciation only (POS → P O S, GCash → G Cash).
"""
import json
import subprocess
import sys
import wave
from pathlib import Path

HERE = Path(__file__).parent
MODEL = sys.argv[1]
SAY = {"POS": "P O S", "GCash": "G Cash", "café": "cafe"}
(HERE / "vo").mkdir(exist_ok=True)


def synth(text, out, length_scale):
    subprocess.run([sys.executable, "-m", "piper", "-m", MODEL, "-f", str(out), "--length-scale", f"{length_scale:.3f}",
                    "--sentence-silence", "0.18"], input=text.encode(), check=True, capture_output=True)
    with wave.open(str(out)) as w:
        return w.getnframes() / w.getframerate()


for line in json.loads((HERE / "voiceover.json").read_text()):
    text = line["text"]
    for k, v in SAY.items():
        text = text.replace(k, v)
    out = HERE / "vo" / f"{line['id']}.wav"
    scale = 1.0
    dur = synth(text, out, scale)
    if dur > line["window"]:
        scale = max(0.82, line["window"] / dur * 0.98)
        dur = synth(text, out, scale)
    print(f"{line['id']}: {dur:.2f}s / {line['window']}s window (length_scale {scale:.2f})  {text}")
