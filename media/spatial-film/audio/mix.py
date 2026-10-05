"""Mixes the voiceover lines over the music and muxes the result onto the film.

Expects one file per line in audio/vo/ named <id>.wav (or .mp3/.m4a), matching voiceover.json.
Each line is placed at its start time. A line longer than its window is gently sped up (max 12%).
The music ducks under the voice through a sidechain compressor.

Usage: python mix.py [film.mp4] [out.mp4]
"""
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
FILM = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE.parent / "sellix-pos-spatial-film-1080p60.mp4"
OUT = Path(sys.argv[2]) if len(sys.argv) > 2 else HERE.parent / "sellix-pos-spatial-film-1080p60-vo.mp4"
lines = json.loads((HERE / "voiceover.json").read_text())


def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]))


inputs, chains, labels = ["-i", str(FILM), "-i", str(HERE / "music.wav")], [], []
for n, line in enumerate(lines):
    clip = next((p for ext in ("wav", "mp3", "m4a", "flac") if (p := HERE / "vo" / f"{line['id']}.{ext}").exists()), None)
    if clip is None:
        print(f"skip {line['id']}: no clip"); continue
    speed = min(1.12, max(1.0, duration(clip) / line["window"]))
    idx = len(inputs) // 2
    inputs += ["-i", str(clip)]
    delay = int(line["start"] * 1000)
    chains.append(f"[{idx}:a]aformat=sample_rates=48000:channel_layouts=stereo,atempo={speed:.3f},"
                  f"highpass=f=80,acompressor=threshold=-20dB:ratio=3:attack=5:release=120,adelay={delay}|{delay}[v{n}]")
    labels.append(f"[v{n}]")
    print(f"{line['id']}: {duration(clip):.2f}s in {line['window']}s window → atempo {speed:.3f}")

if not labels:
    sys.exit("no voiceover clips found in audio/vo/")
graph = ";".join(chains) + ";" + "".join(labels) + f"amix=inputs={len(labels)}:normalize=0,apad=whole_dur=40,atrim=0:40[vo];" \
    "[vo]asplit[vo1][vo2];" \
    "[1:a][vo1]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=350:makeup=1[bed];" \
    "[bed][vo2]amix=inputs=2:weights='0.55 1':normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9[mix]"
subprocess.run(["ffmpeg", "-v", "error", "-y", *inputs, "-filter_complex", graph, "-map", "0:v:0", "-map", "[mix]",
                "-c:v", "copy", "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-shortest", "-movflags", "+faststart", str(OUT)], check=True)
print("wrote", OUT)
