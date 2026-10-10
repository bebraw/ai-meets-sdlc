"""Encode the reviewed Blender image sequences with credited music excerpts."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("variant", choices=["a", "b", "c"])
parser.add_argument("--patch-directory", type=Path)
parser.add_argument("--patch-x", type=int, default=0)
parser.add_argument("--patch-y", type=int, default=0)
args = parser.parse_args()
root = Path(__file__).resolve().parents[2]
output = root / "output/intro/prototypes-02"
frames = output / (args.variant + "-frames")
missing = [i for i in range(1, 865) if not (frames / f"{i:04d}.jpg").is_file()]
if missing:
    raise RuntimeError(f"Incomplete render, missing {len(missing)} frames: {missing[:8]}")
music = output / ("music-c.wav" if args.variant == "c" else "music-ab.wav")
destination = output / (args.variant + ".mp4")
credit = (output / "music-credit.txt").read_text()
titles = {"a":"The changing loop", "b":"The SDLC machine", "c":"Demoscene"}
patch_input, video_filter = [], ["-vf", "fade=t=out:st=35.5:d=0.5,format=yuv420p"]
video_map = "0:v:0"
if args.patch_directory:
    if any(not (args.patch_directory / f"{i:04d}.png").is_file() for i in range(1, 865)):
        raise RuntimeError("Incomplete render patch sequence")
    patch_input = ["-framerate", "24", "-start_number", "1", "-i", str(args.patch_directory / "%04d.png")]
    video_filter = ["-filter_complex", f"[0:v][2:v]overlay={args.patch_x}:{args.patch_y}:format=auto,fade=t=out:st=35.5:d=0.5,format=yuv420p[v]"]
    video_map = "[v]"
subprocess.run([
    "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-framerate", "24", "-start_number", "1",
    "-i", str(frames / "%04d.jpg"), "-i", str(music), *patch_input, *video_filter,
    "-map", video_map, "-map", "1:a:0", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-t", "36", "-movflags", "+faststart",
    "-metadata", "title=SDLCAI / " + titles[args.variant] + " / motion prototype",
    "-metadata", "comment=" + credit, str(destination),
], check=True)
subprocess.run([
    "ffmpeg", "-hide_banner", "-loglevel", "warning", "-y", "-ss", str(299/24), "-i", str(destination),
    "-vf", "scale=1280:720", "-q:v", "2", "-frames:v", "1", "-update", "1", str(output / (args.variant + "-poster.jpg")),
], check=True)
probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(destination)]))
video = next(s for s in probe["streams"] if s["codec_type"] == "video")
audio = next(s for s in probe["streams"] if s["codec_type"] == "audio")
assert (video["width"], video["height"], video["r_frame_rate"], int(video["nb_frames"])) == (1920, 1080, "24/1", 864)
assert audio["sample_rate"] == "48000" and audio["channels"] == 2
assert abs(float(probe["format"]["duration"]) - 36) < .01
subprocess.run(["ffmpeg", "-v", "error", "-i", str(destination), "-f", "null", "-"], check=True)
report = {"variant":args.variant, "bytes":destination.stat().st_size, "sha256":hashlib.sha256(destination.read_bytes()).hexdigest(), "duration":36, "frames":864, "video":"1920x1080 H.264 24 fps", "audio":"AAC stereo 48000 Hz", "decode":"passed"}
(output / (args.variant + "-report.json")).write_text(json.dumps(report, indent=2)+"\n")
print(json.dumps(report))
