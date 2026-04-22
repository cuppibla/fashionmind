"""Generate a Veo video of the panda avatar speaking through all mouth shapes.

Uses the existing idle.png as a reference image to maintain character consistency.
The generated video is saved locally and to GCS for frame extraction.

Usage:
    cd /Users/annie/Documents/Demo/fashionmind
    python scripts/generate_avatar_video.py

Prerequisites:
    pip install google-genai google-cloud-storage
    gcloud auth application-default login
"""

import asyncio
import os
import sys
import time
import uuid

# ─── Config ─────────────────────────────────────────────────────────
PROJECT_ID = "neon-emitter-458622-e3"
LOCATION = "us-central1"
GCS_BUCKET = "gemini-motion-lab"  # reuse existing bucket
VEO_MODEL = "veo-3.1-fast-generate-001"

# Local paths
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(SCRIPT_DIR)
REFERENCE_IMAGE = os.path.join(PROJECT_ROOT, "frontend", "public", "avatar", "idle.png")
OUTPUT_DIR = os.path.join(PROJECT_ROOT, "scripts", "avatar_video_output")


# ─── Prompt ─────────────────────────────────────────────────────────
AVATAR_VIDEO_PROMPT = """
A cute cartoon panda character wearing round gold-rimmed glasses and a teal blazer
with a Google Cloud pin, standing against a dark navy starry background.

The panda cycles through these EXACT mouth positions slowly and clearly,
holding each for about 1 second:

1. IDLE — mouth closed, gentle smile (starting position)
2. CONSONANT — mouth barely open, lips lightly parted
3. MOUTH O — lips puckered into a round "O" shape
4. MOUTH A — mouth wide open, big "aah" sound
5. MOUTH E — mouth wide and stretched horizontally, showing teeth in an "eee" shape
6. BLINK — eyes fully closed, content smile, mouth closed (like a happy blink)
7. Return to IDLE position

Important: The character design MUST remain perfectly consistent throughout —
same glasses, same blazer, same pin, same proportions, same art style.
The ONLY thing that changes is the mouth shape and eye state.
Chibi/kawaii anime illustration style. No background movement.
Camera is static, centered on the character from chest up.
""".strip()


async def main():
    print("=" * 60)
    print("  Panda Avatar Video Generation (Veo)")
    print("=" * 60)

    # ─── Verify reference image exists ────────────────────────────
    if not os.path.exists(REFERENCE_IMAGE):
        print(f"\n❌ Reference image not found: {REFERENCE_IMAGE}")
        sys.exit(1)
    print(f"\n✅ Reference image: {REFERENCE_IMAGE}")

    # ─── Upload reference image to GCS ────────────────────────────
    from google.cloud import storage as gcs

    storage_client = gcs.Client(project=PROJECT_ID)
    bucket = storage_client.bucket(GCS_BUCKET)

    video_id = f"panda-avatar-{uuid.uuid4().hex[:8]}"
    gcs_image_path = f"fashionmind-avatar/{video_id}/reference.png"
    gcs_image_uri = f"gs://{GCS_BUCKET}/{gcs_image_path}"

    print(f"📤 Uploading reference image to {gcs_image_uri} ...")
    blob = bucket.blob(gcs_image_path)
    blob.upload_from_filename(REFERENCE_IMAGE, content_type="image/png")
    print("   Done.")

    # ─── Generate video via Veo ───────────────────────────────────
    from google import genai
    from google.genai.types import GenerateVideosConfig, Image, VideoGenerationReferenceImage

    client = genai.Client(vertexai=True, project=PROJECT_ID, location=LOCATION)

    output_gcs_uri = f"gs://{GCS_BUCKET}/fashionmind-avatar/{video_id}/output/"
    print(f"\n🎬 Starting Veo generation...")
    print(f"   Model:  {VEO_MODEL}")
    print(f"   Output: {output_gcs_uri}")
    print(f"   Prompt: {AVATAR_VIDEO_PROMPT[:80]}...")

    config = GenerateVideosConfig(
        reference_images=[
            VideoGenerationReferenceImage(
                image=Image(gcs_uri=gcs_image_uri, mime_type="image/png"),
                reference_type="ASSET",
            )
        ],
        aspect_ratio="9:16",      # Portrait — closest to avatar's chest-up framing
        duration_seconds=8,       # 8 seconds to cover all mouth shapes
        generate_audio=False,     # No audio needed
        person_generation="allow_all",
        output_gcs_uri=output_gcs_uri,
    )

    try:
        operation = client.models.generate_videos(
            model=VEO_MODEL,
            prompt=AVATAR_VIDEO_PROMPT,
            config=config,
        )
    except Exception as e:
        print(f"\n❌ Veo API call failed: {e}")
        sys.exit(1)

    print(f"   Operation started. Polling for completion...")

    # ─── Poll until done ──────────────────────────────────────────
    start = time.time()
    while True:
        elapsed = int(time.time() - start)
        try:
            current = client.operations.get(operation)
        except Exception as e:
            print(f"   ⚠️  Poll error ({elapsed}s): {e}")
            await asyncio.sleep(10)
            continue

        if current.done:
            # Check for error
            op_error = getattr(current, "error", None)
            if op_error and getattr(op_error, "code", 0):
                print(f"\n❌ Veo generation failed ({elapsed}s): {getattr(op_error, 'message', op_error)}")
                sys.exit(1)

            # Extract output URI
            result = getattr(current, "result", None)
            generated_videos = getattr(result, "generated_videos", None) if result else None
            if generated_videos:
                output_uri = generated_videos[0].video.uri
                print(f"\n✅ Video generated ({elapsed}s)!")
                print(f"   GCS URI: {output_uri}")

                # Download locally
                os.makedirs(OUTPUT_DIR, exist_ok=True)
                local_path = os.path.join(OUTPUT_DIR, f"{video_id}.mp4")
                _download_from_gcs(storage_client, output_uri, local_path)
                print(f"   Local:   {local_path}")
                print(f"\n🎯 Next step: Run the frame extraction script:")
                print(f"   python scripts/extract_avatar_frames.py {local_path}")
                return
            else:
                print(f"\n❌ No generated videos in result ({elapsed}s)")
                print(f"   result={result}")
                sys.exit(1)

        # Still processing
        mins, secs = divmod(elapsed, 60)
        print(f"   ⏳ Processing... ({mins}m {secs}s)", end="\r")
        await asyncio.sleep(10)


def _download_from_gcs(storage_client, gcs_uri: str, local_path: str):
    """Download a GCS URI to a local file."""
    # Parse gs://bucket/path
    parts = gcs_uri.replace("gs://", "").split("/", 1)
    bucket_name, blob_path = parts[0], parts[1]
    bucket = storage_client.bucket(bucket_name)
    blob = bucket.blob(blob_path)
    print(f"📥 Downloading to {local_path} ...")
    blob.download_to_filename(local_path)
    print("   Done.")


if __name__ == "__main__":
    asyncio.run(main())
