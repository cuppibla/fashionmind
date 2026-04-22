"""Extract key frames from a Veo-generated panda avatar video.

This script:
1. Dumps all frames from the video at a configurable FPS
2. Opens an HTML gallery so you can visually pick the best frame for each mouth shape
3. Copies your selected frames to frontend/public/avatar/ with the correct filenames

Usage:
    # Step 1: Extract all frames at 10fps for browsing
    python scripts/extract_avatar_frames.py scripts/avatar_video_output/<video_id>.mp4

    # Step 2: Once you've identified frame numbers, extract specific ones
    python scripts/extract_avatar_frames.py scripts/avatar_video_output/<video_id>.mp4 \
        --pick idle=15 consonant=22 mouth_O=35 mouth_A=48 mouth_E=60 blink=73

Prerequisites:
    brew install ffmpeg   (if not already installed)
"""

import argparse
import os
import shutil
import subprocess
import sys
import webbrowser

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
AVATAR_DIR = os.path.join(PROJECT_ROOT, "frontend", "public", "avatar")

# The 6 frame names that AvatarScene.tsx expects
FRAME_NAMES = ["idle", "consonant", "mouth_O", "mouth_A", "mouth_E", "blink"]

FRAME_DESCRIPTIONS = {
    "idle":      "Mouth closed, gentle smile (resting face)",
    "consonant": "Mouth barely open, lips lightly parted",
    "mouth_O":   "Lips puckered into a round 'O' shape",
    "mouth_A":   "Mouth wide open (big 'aah')",
    "mouth_E":   "Mouth stretched horizontally ('eee', may show teeth)",
    "blink":     "Eyes fully closed, content expression",
}


def check_ffmpeg():
    """Verify ffmpeg is installed."""
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def extract_all_frames(video_path: str, output_dir: str, fps: int = 10):
    """Extract frames from video at given FPS."""
    os.makedirs(output_dir, exist_ok=True)

    cmd = [
        "ffmpeg", "-y",
        "-i", video_path,
        "-vf", f"fps={fps}",
        "-q:v", "2",
        os.path.join(output_dir, "frame_%04d.png"),
    ]

    print(f"🎞️  Extracting frames at {fps} fps...")
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"❌ ffmpeg error:\n{result.stderr}")
        sys.exit(1)

    frames = sorted([f for f in os.listdir(output_dir) if f.startswith("frame_") and f.endswith(".png")])
    print(f"   Extracted {len(frames)} frames to {output_dir}/")
    return frames


def generate_gallery_html(frames_dir: str, frames: list[str], html_path: str):
    """Generate an HTML gallery for visual frame selection."""
    frame_cards = ""
    for i, frame in enumerate(frames, 1):
        frame_cards += f"""
        <div class="card" onclick="selectFrame({i}, '{frame}')">
            <img src="file://{os.path.join(frames_dir, frame)}" alt="{frame}">
            <div class="label">#{i} — {frame}</div>
        </div>"""

    target_list = ""
    for name in FRAME_NAMES:
        desc = FRAME_DESCRIPTIONS[name]
        target_list += f"""
        <div class="target" id="target-{name}">
            <span class="target-name">{name}.png</span>
            <span class="target-desc">{desc}</span>
            <select id="select-{name}" onchange="updateCommand()">
                <option value="">— pick frame —</option>
                {"".join(f'<option value="{i+1}">Frame #{i+1}</option>' for i in range(len(frames)))}
            </select>
            <img id="preview-{name}" class="preview" src="" style="display:none">
        </div>"""

    html = f"""<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>Avatar Frame Picker</title>
<style>
    * {{ margin: 0; padding: 0; box-sizing: border-box; }}
    body {{ font-family: system-ui, sans-serif; background: #0d1117; color: #e6edf3; padding: 20px; }}
    h1 {{ text-align: center; margin-bottom: 8px; color: #58a6ff; }}
    .subtitle {{ text-align: center; color: #8b949e; margin-bottom: 24px; }}

    .targets {{ display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 24px;
                background: #161b22; padding: 16px; border-radius: 12px; border: 1px solid #30363d; }}
    .target {{ flex: 1; min-width: 200px; padding: 12px; border-radius: 8px;
               background: #0d1117; border: 1px solid #21262d; }}
    .target-name {{ display: block; font-weight: 700; color: #79c0ff; font-size: 14px; }}
    .target-desc {{ display: block; font-size: 11px; color: #8b949e; margin: 4px 0 8px; }}
    .target select {{ width: 100%; padding: 6px; border-radius: 6px;
                      background: #21262d; color: #e6edf3; border: 1px solid #30363d; }}
    .preview {{ width: 100%; margin-top: 8px; border-radius: 6px; }}

    .gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
                gap: 8px; }}
    .card {{ cursor: pointer; border-radius: 8px; overflow: hidden;
             background: #161b22; border: 2px solid transparent; transition: all 0.2s; }}
    .card:hover {{ border-color: #58a6ff; transform: scale(1.03); }}
    .card.selected {{ border-color: #3fb950; }}
    .card img {{ width: 100%; display: block; }}
    .label {{ text-align: center; font-size: 11px; padding: 4px; color: #8b949e; }}

    .command-box {{ margin-top: 24px; padding: 16px; background: #161b22; border-radius: 12px;
                    border: 1px solid #30363d; }}
    .command-box h3 {{ color: #3fb950; margin-bottom: 8px; }}
    #command {{ font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
                color: #f0883e; word-break: break-all; white-space: pre-wrap; user-select: all;
                background: #0d1117; padding: 12px; border-radius: 8px; cursor: text; }}
</style></head>
<body>
<h1>🐼 Avatar Frame Picker</h1>
<p class="subtitle">Select the best frame for each mouth shape. The command below auto-updates.</p>

<div class="targets">{target_list}</div>

<div class="command-box">
    <h3>📋 Copy & run this command when ready:</h3>
    <div id="command">Select frames above first...</div>
</div>

<h2 style="margin: 24px 0 12px; color: #58a6ff;">All Frames ({len(frames)} total)</h2>
<div class="gallery">{frame_cards}</div>

<script>
const FRAMES_DIR = "{frames_dir}";
const FRAME_NAMES = {FRAME_NAMES};
let currentTarget = null;

function selectFrame(num, filename) {{
    if (!currentTarget) {{
        // If no target selected, find first empty one
        for (const name of FRAME_NAMES) {{
            const sel = document.getElementById('select-' + name);
            if (!sel.value) {{ currentTarget = name; break; }}
        }}
        if (!currentTarget) currentTarget = FRAME_NAMES[0];
    }}
    document.getElementById('select-' + currentTarget).value = num;
    updateCommand();
    // Move to next target
    const idx = FRAME_NAMES.indexOf(currentTarget);
    if (idx < FRAME_NAMES.length - 1) currentTarget = FRAME_NAMES[idx + 1];
}}

function updateCommand() {{
    const picks = [];
    let allPicked = true;
    for (const name of FRAME_NAMES) {{
        const sel = document.getElementById('select-' + name);
        const preview = document.getElementById('preview-' + name);
        if (sel.value) {{
            picks.push(name + '=' + sel.value);
            const framePath = FRAMES_DIR + '/frame_' + String(sel.value).padStart(4, '0') + '.png';
            preview.src = 'file://' + framePath;
            preview.style.display = 'block';
        }} else {{
            allPicked = false;
            preview.style.display = 'none';
        }}
    }}
    const cmdEl = document.getElementById('command');
    if (picks.length === 0) {{
        cmdEl.textContent = 'Select frames above first...';
    }} else {{
        cmdEl.textContent = 'python scripts/extract_avatar_frames.py scripts/avatar_video_output/VIDEO.mp4 --pick ' + picks.join(' ');
    }}
}}
</script>
</body></html>"""

    with open(html_path, "w") as f:
        f.write(html)
    return html_path


def pick_frames(video_path: str, frames_dir: str, picks: dict[str, int]):
    """Extract specific frames and copy to avatar directory."""
    print(f"\n🎯 Extracting {len(picks)} key frames...")

    # Backup existing avatars
    backup_dir = os.path.join(AVATAR_DIR, "_backup")
    os.makedirs(backup_dir, exist_ok=True)
    for name in FRAME_NAMES:
        src = os.path.join(AVATAR_DIR, f"{name}.png")
        if os.path.exists(src):
            dst = os.path.join(backup_dir, f"{name}.png")
            shutil.copy2(src, dst)
    print(f"   📁 Backed up existing frames to {backup_dir}/")

    # Copy selected frames
    for name, frame_num in picks.items():
        frame_file = f"frame_{frame_num:04d}.png"
        src = os.path.join(frames_dir, frame_file)
        if not os.path.exists(src):
            print(f"   ❌ Frame {frame_file} not found in {frames_dir}")
            continue

        dst = os.path.join(AVATAR_DIR, f"{name}.png")
        shutil.copy2(src, dst)
        print(f"   ✅ {name}.png ← {frame_file}")

    print(f"\n🎉 Done! Frames saved to {AVATAR_DIR}/")
    print("   The app will pick them up automatically (hot reload).")
    print(f"   Old frames backed up to {backup_dir}/")


def main():
    parser = argparse.ArgumentParser(description="Extract avatar key frames from Veo video")
    parser.add_argument("video_path", help="Path to the Veo-generated video file")
    parser.add_argument("--fps", type=int, default=10,
                        help="Frames per second to extract (default: 10)")
    parser.add_argument("--pick", nargs="+", metavar="NAME=FRAME_NUM",
                        help="Pick specific frames, e.g.: idle=15 consonant=22 mouth_O=35")
    parser.add_argument("--no-browser", action="store_true",
                        help="Don't open the gallery in a browser")
    args = parser.parse_args()

    if not os.path.exists(args.video_path):
        print(f"❌ Video not found: {args.video_path}")
        sys.exit(1)

    if not check_ffmpeg():
        print("❌ ffmpeg not found. Install with: brew install ffmpeg")
        sys.exit(1)

    # Determine frames directory
    video_basename = os.path.splitext(os.path.basename(args.video_path))[0]
    frames_dir = os.path.join(SCRIPT_DIR, "avatar_video_output", f"{video_basename}_frames")

    if args.pick:
        # ─── Mode 2: Copy specific frames to avatar dir ──────────
        picks = {}
        for item in args.pick:
            if "=" not in item:
                print(f"❌ Invalid pick format '{item}'. Use NAME=FRAME_NUM (e.g. idle=15)")
                sys.exit(1)
            name, num = item.split("=", 1)
            if name not in FRAME_NAMES:
                print(f"❌ Unknown frame name '{name}'. Valid: {', '.join(FRAME_NAMES)}")
                sys.exit(1)
            picks[name] = int(num)

        missing = set(FRAME_NAMES) - set(picks.keys())
        if missing:
            print(f"⚠️  Warning: Missing picks for: {', '.join(missing)}")
            print("   Those frames will keep their current images.")

        pick_frames(args.video_path, frames_dir, picks)

    else:
        # ─── Mode 1: Extract all frames + open gallery ───────────
        frames = extract_all_frames(args.video_path, frames_dir, fps=args.fps)

        if not frames:
            print("❌ No frames extracted. Check the video file.")
            sys.exit(1)

        # Generate gallery HTML
        gallery_path = os.path.join(frames_dir, "gallery.html")
        generate_gallery_html(frames_dir, frames, gallery_path)
        print(f"\n📸 Gallery: {gallery_path}")

        if not args.no_browser:
            webbrowser.open(f"file://{gallery_path}")
            print("   Opened in browser. Pick the best frame for each mouth shape!")

        print(f"\n📝 Once you've identified the frame numbers, run:")
        print(f"   python scripts/extract_avatar_frames.py {args.video_path} \\")
        print(f"       --pick idle=N consonant=N mouth_O=N mouth_A=N mouth_E=N blink=N")
        print(f"\n   Where N is the frame number from the gallery.")


if __name__ == "__main__":
    main()
