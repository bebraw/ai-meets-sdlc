"""Finish the native 4K Draft 03 frames; no video fades or title animation.

Run after all 2,880 Blender JPEGs have finished rendering:
    python3 scripts/intro/finish_draft03.py
    python3 scripts/intro/finish_draft03.py --preview-only

Existing videos are reused only after their input fingerprint, media properties,
faststart placement and full decode pass validation. Interrupted encodes remain
temporary and never replace a finished export.
"""

import argparse
from datetime import datetime, timezone
from fractions import Fraction
import hashlib
import json
from pathlib import Path
import struct
import subprocess


ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / "output/intro/draft-03"
FRAMES = OUTPUT / "frames"
FPS = 24
DURATION = 120
FRAME_COUNT = FPS * DURATION
POSTER_FRAME = 77
SCHEMA = 2
SOF_MARKERS = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
               0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def jpeg_dimensions(path):
    """Read JPEG SOF dimensions without decoding or a Pillow dependency."""
    with path.open("rb") as source:
        if source.read(2) != b"\xff\xd8":
            raise ValueError(f"Not a JPEG: {path}")
        source.seek(-2, 2)
        if source.read(2) != b"\xff\xd9":
            raise ValueError(f"Incomplete JPEG: {path}")
        source.seek(2)
        while True:
            if source.read(1) != b"\xff":
                raise ValueError(f"Invalid JPEG marker: {path}")
            marker = source.read(1)
            while marker == b"\xff":
                marker = source.read(1)
            if not marker or marker[0] in (0xD9, 0xDA):
                raise ValueError(f"JPEG has no readable dimensions: {path}")
            if marker[0] == 0x01 or 0xD0 <= marker[0] <= 0xD8:
                continue
            length_bytes = source.read(2)
            if len(length_bytes) != 2:
                raise ValueError(f"Truncated JPEG marker: {path}")
            length = struct.unpack(">H", length_bytes)[0]
            if length < 2:
                raise ValueError(f"Invalid JPEG segment length: {path}")
            if marker[0] in SOF_MARKERS:
                data = source.read(5)
                if len(data) != 5:
                    raise ValueError(f"Truncated JPEG dimensions: {path}")
                height, width = struct.unpack(">HH", data[1:5])
                return width, height
            source.seek(length - 2, 1)


def probe(path):
    return json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_streams", "-show_format",
        "-of", "json", str(path),
    ], text=True))


def run_logged(command, log):
    with log.open("w") as stream:
        result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f"Command failed ({result.returncode}); see {log}")


def full_decode(path, label):
    run_logged([
        "ffmpeg", "-hide_banner", "-nostdin", "-v", "error", "-xerror",
        "-err_detect", "explode", "-i", str(path),
        "-map", "0:v:0", "-map", "0:a:0", "-f", "null", "-",
    ], OUTPUT / f"{label}-decode.log")


def faststart(path):
    """Check the MP4 moov atom precedes media, including extended-size atoms."""
    atoms = {}
    file_size = path.stat().st_size
    with path.open("rb") as source:
        while source.tell() < file_size:
            offset = source.tell()
            header = source.read(8)
            if len(header) != 8:
                raise ValueError(f"Truncated MP4 atom in {path}")
            size, kind = struct.unpack(">I4s", header)
            header_size = 8
            if size == 1:
                extended = source.read(8)
                if len(extended) != 8:
                    raise ValueError(f"Truncated extended MP4 atom in {path}")
                size = struct.unpack(">Q", extended)[0]
                header_size = 16
            elif size == 0:
                size = file_size - offset
            if size < header_size or offset + size > file_size:
                raise ValueError(f"Invalid MP4 atom length in {path}")
            atoms.setdefault(kind, offset)
            source.seek(offset + size)
    return b"moov" in atoms and b"mdat" in atoms and atoms[b"moov"] < atoms[b"mdat"]


def check(condition, message):
    if not condition:
        raise ValueError(message)


def inspect_video(path, width, height, credit, provenance, decode=True):
    data = probe(path)
    videos = [s for s in data["streams"] if s["codec_type"] == "video"]
    audios = [s for s in data["streams"] if s["codec_type"] == "audio"]
    check(len(videos) == len(audios) == 1, f"Expected one video and audio stream: {path}")
    video, audio = videos[0], audios[0]
    check((video["width"], video["height"]) == (width, height), f"Wrong resolution: {path}")
    check(video["codec_name"] == "h264" and video["pix_fmt"] == "yuv420p", f"Wrong video format: {path}")
    check(video.get("color_range") == "tv" and video.get("color_space") == "bt709",
          f"Expected explicit limited-range BT.709 video: {path}")
    check(Fraction(video["r_frame_rate"]) == FPS and Fraction(video["avg_frame_rate"]) == FPS,
          f"Wrong frame rate: {path}")
    check(int(video["nb_frames"]) == FRAME_COUNT, f"Wrong frame count: {path}")
    check(abs(float(video["duration"]) - DURATION) < 0.001, f"Wrong video duration: {path}")
    check(abs(float(data["format"]["duration"]) - DURATION) < 0.001, f"Wrong container duration: {path}")
    check(audio["codec_name"] == "aac" and audio["sample_rate"] == "48000" and audio["channels"] == 2,
          f"Wrong audio format: {path}")
    check(abs(float(audio["duration"]) - DURATION) < 0.025, f"Wrong audio duration: {path}")
    tags = data["format"].get("tags", {})
    check(tags.get("comment") == credit, f"Missing or outdated full music attribution: {path}")
    check(tags.get("description") == provenance, f"Source fingerprint or provenance differs: {path}")
    check(faststart(path), f"MP4 is not optimized for faststart: {path}")
    if decode:
        full_decode(path, "4k" if width == 3840 else "preview")
    return {
        "path": path.name, "bytes": path.stat().st_size, "sha256": sha256(path),
        "width": width, "height": height, "fps": FPS, "frames": FRAME_COUNT,
        "durationSeconds": float(data["format"]["duration"]),
        "videoCodec": video["codec_name"], "pixelFormat": video["pix_fmt"],
        "colorRange": video["color_range"], "colorSpace": video["color_space"],
        "audioCodec": audio["codec_name"], "audioSampleRate": int(audio["sample_rate"]),
        "audioChannels": audio["channels"], "audioBitRate": int(audio.get("bit_rate", 0)),
        "faststart": "passed", "fullDecode": "passed" if decode else "not run",
        "fullMusicAttributionMetadata": "verified",
    }


def source_manifest(credit):
    expected = [FRAMES / f"{i:04d}.jpg" for i in range(1, FRAME_COUNT + 1)]
    missing = [p.name for p in expected if not p.is_file()]
    if missing:
        raise ValueError(f"Render incomplete: {len(missing)} missing frames; first: {missing[:8]}")
    print(f"Checking and hashing all {FRAME_COUNT} native 3840x2160 frames…", flush=True)
    records = []
    for path in expected:
        before = path.stat()
        check(jpeg_dimensions(path) == (3840, 2160), f"Frame is not native 3840x2160: {path}")
        digest = sha256(path)
        after = path.stat()
        check((before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns),
              f"Frame changed while reading; wait for rendering to finish: {path}")
        records.append({"name": path.name, "bytes": after.st_size, "sha256": digest})
    music = OUTPUT / "music.wav"
    audio_data = probe(music)
    audio = next(s for s in audio_data["streams"] if s["codec_type"] == "audio")
    check(audio["codec_name"] == "pcm_s24le" and audio["sample_rate"] == "48000" and audio["channels"] == 2,
          "music.wav must be 48 kHz stereo 24-bit PCM")
    check(abs(float(audio_data["format"]["duration"]) - DURATION) < 0.001,
          "music.wav must be exactly 120 seconds")
    manifest = {
        "schema": SCHEMA, "frames": records, "frameCount": FRAME_COUNT,
        "width": 3840, "height": 2160, "fps": FPS, "durationSeconds": DURATION,
        "music": {"name": music.name, "bytes": music.stat().st_size, "sha256": sha256(music)},
        "creditSha256": hashlib.sha256(credit.encode()).hexdigest(),
        "encoding": {"codec": "libx264", "crf": 18, "preset": "medium", "pixelFormat": "yuv420p",
                     "colorRange": "tv", "colorSpace": "bt709", "sourceJpegRange": "pc", "sourceJpegMatrix": "bt601",
                     "audioCodec": "aac", "audioBitRate": 256000, "audioSampleRate": 48000, "audioChannels": 2},
    }
    fingerprint = hashlib.sha256(json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    manifest["sourceFingerprint"] = fingerprint
    manifest["native4KProvenance"] = (
        "All 2880 source JPEG headers verified at 3840x2160. The master encodes these "
        "Blender render frames directly at 24 fps, with pixel-format conversion only; "
        "no spatial upscaling, frame interpolation, video fades or text animation is added."
    )
    (OUTPUT / "source-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


def metadata(credit, provenance):
    return [
        "-metadata", "title=SDLCAI 2026 / Demoscene / Draft 03",
        "-metadata", "comment=" + credit,
        "-metadata", "description=" + provenance,
        "-metadata", "copyright=Music: Cipher by Kevin MacLeod (incompetech.com), CC BY 4.0. https://creativecommons.org/licenses/by/4.0/",
    ]


def finish_video(name, dimensions, credit, provenance, source_master=None, force=False):
    destination = OUTPUT / name
    width, height = dimensions
    if destination.is_file() and not force:
        try:
            print(f"Validating existing {name}…", flush=True)
            report = inspect_video(destination, width, height, credit, provenance)
            report["reused"] = True
            report["encodedFrom"] = "Previously finished export with the same verified native-frame fingerprint"
            print(f"Reusing verified {name}.", flush=True)
            return report
        except (ValueError, KeyError, RuntimeError, subprocess.CalledProcessError) as error:
            print(f"Rebuilding {name}: {error}", flush=True)
    temporary = OUTPUT / f".{destination.stem}.pending.mp4"
    command = ["ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "warning", "-xerror", "-y"]
    if source_master:
        command += ["-i", str(source_master), "-map", "0:v:0", "-map", "0:a:0",
                    "-vf", "scale=1920:1080:flags=lanczos:in_range=tv:out_range=tv:in_color_matrix=bt709:out_color_matrix=bt709,format=yuv420p", "-c:a", "copy"]
    else:
        command += ["-framerate", str(FPS), "-start_number", "1", "-i", str(FRAMES / "%04d.jpg"),
                    "-i", str(OUTPUT / "music.wav"), "-map", "0:v:0", "-map", "1:a:0",
                    # JPEG inputs carry full-range BT.601 metadata. Convert the
                    # samples and tag the output explicitly; format=yuv420p alone
                    # can otherwise retain full-range JPEG metadata in H.264.
                    "-vf", f"scale={width}:{height}:flags=lanczos:in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709,format=yuv420p",
                    "-c:a", "aac", "-b:a", "256k", "-ar", "48000", "-ac", "2"]
    command += ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
                "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
                "-fps_mode", "cfr", "-r", str(FPS), "-t", str(DURATION), "-movflags", "+faststart",
                "-map_metadata", "-1", *metadata(credit, provenance), str(temporary)]
    print(f"Encoding {name} ({width}x{height})…", flush=True)
    run_logged(command, OUTPUT / f"{destination.stem}-encode.log")
    report = inspect_video(temporary, width, height, credit, provenance)
    temporary.replace(destination)
    report.update({"path": name, "reused": False,
                   "encodedFrom": "Verified 4K master" if source_master else "Native 3840x2160 JPEG sequence"})
    return report


def finish_poster(manifest):
    source = FRAMES / f"{POSTER_FRAME:04d}.jpg"
    temporary = OUTPUT / ".poster.pending.jpg"
    destination = OUTPUT / "poster.jpg"
    run_logged([
        "ffmpeg", "-hide_banner", "-nostdin", "-loglevel", "warning", "-xerror", "-y",
        "-i", str(source), "-vf", "scale=1920:1080:flags=lanczos", "-q:v", "2",
        "-frames:v", "1", "-update", "1", str(temporary),
    ], OUTPUT / "poster-encode.log")
    check(jpeg_dimensions(temporary) == (1920, 1080), "Wrong poster dimensions")
    run_logged(["ffmpeg", "-nostdin", "-v", "error", "-xerror", "-i", str(temporary),
                "-f", "null", "-"], OUTPUT / "poster-decode.log")
    temporary.replace(destination)
    return {"path": destination.name, "bytes": destination.stat().st_size, "sha256": sha256(destination),
            "width": 1920, "height": 1080, "sourceFrame": source.name,
            "sourceTimeSeconds": (POSTER_FRAME - 1) / FPS,
            "sourceFrameSha256": manifest["frames"][POSTER_FRAME - 1]["sha256"], "fullDecode": "passed"}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preview-only", action="store_true",
                        help="Create the 1080p preview directly from completed native frames; skip the 4K encode.")
    parser.add_argument("--force", action="store_true", help="Re-encode even when an existing export validates.")
    args = parser.parse_args()
    credit = (OUTPUT / "music-credit.txt").read_text()
    check(all(value in credit for value in ("Cipher", "Kevin MacLeod", "https://creativecommons.org/licenses/by/4.0/", "Changes:")),
          "music-credit.txt must contain the full attribution, licence URL and changes")
    manifest = source_manifest(credit)
    provenance = ("Native 3840x2160 Blender render sequence / 2880 frames / 24 fps / "
                  "120 seconds. 4K master is not upscaled; 1080p preview is downsampled. "
                  "Source fingerprint: " + manifest["sourceFingerprint"])
    report = {"schema": SCHEMA, "createdAt": datetime.now(timezone.utc).isoformat(),
              "sourceFingerprint": manifest["sourceFingerprint"],
              "sourceManifest": "source-manifest.json", "native4KProvenance": manifest["native4KProvenance"],
              "mode": "preview-only" if args.preview_only else "full", "files": {}}
    master = None
    if not args.preview_only:
        report["files"]["master"] = finish_video("4k.mp4", (3840, 2160), credit, provenance, force=args.force)
        master = OUTPUT / "4k.mp4"
    report["files"]["preview"] = finish_video("preview.mp4", (1920, 1080), credit, provenance,
                                                source_master=master, force=args.force)
    report["files"]["poster"] = finish_poster(manifest)
    report["files"]["credit"] = {"path": "music-credit.txt", "sha256": sha256(OUTPUT / "music-credit.txt")}
    report["previewSource"] = "Native 3840x2160 render sequence, downsampled directly or via its validated 4K master"
    report["videoProcessing"] = "Pixel-format conversion; preview/poster downsampling. No video fades or additional text motion."
    report_path = OUTPUT / ("preview-report.json" if args.preview_only else "render-report.json")
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"report": str(report_path), "sourceFingerprint": manifest["sourceFingerprint"],
                      "files": report["files"]}, indent=2))


if __name__ == "__main__":
    main()
