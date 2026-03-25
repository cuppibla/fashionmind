# FashionMind Demo Design: Live Multimodal Memory With ADK, Memory Bank, and Cloud SQL

## Summary

This design enables a Cloud Next demo where FashionMind uses live audio plus lightweight camera input to create durable, cross-session memory without pretending to recognize a full wardrobe. The system uses ADK for live multimodal interaction, Vertex AI Memory Bank for semantic long-term memory, and Cloud SQL for structured app state.

The core principle is:

- process live video transiently for perception
- persist only semantic meaning and structured outcomes

Relevant current implementation points:

- Live websocket + ADK runner: `backend/main.py`
- Agent + memory tool setup: `backend/agent/agent.py`
- Session/memory service wiring: `backend/agent/services.py`
- Current left-panel proof surface: `frontend/src/components/UserSidePanel.tsx`
- Camera snapshot capture: `frontend/src/hooks/useWebcamSnapshot.ts`

## Demo Goal

The demo should prove three things:

- The agent can understand live voice and camera input in one session.
- The agent can persist stable user style facts across sessions with Memory Bank.
- The app can persist structured user state in Cloud SQL and show it in the UI.

The intended wow moment is not "the model stored my video." It is: "the model remembered the meaning of what I said and showed."

## Storage Responsibilities

| Layer | Purpose | Examples |
|---|---|---|
| ADK Live Session | Real-time perception and response | audio stream, image frame, live reply |
| Memory Bank | Durable semantic memory across sessions | "defaults to black", "hat is signature piece", "hates itchy fabrics" |
| Cloud SQL | Canonical structured app state | occasions, wishlist, purchases, profile, later product catalog |
| Optional GCS | Media artifact retention only if needed | manually shared snapshot URI for audit/demo replay |

## What Should Be Stored

Store in Memory Bank:

- Style identity
- Comfort constraints
- Signature accessories
- Conference-specific dressing context
- Stable visual cues that were verbally anchored

Store in Cloud SQL:

- Occasions
- Wishlist items
- Purchases
- Profile/body type
- Catalog and product search later

Do not store as Memory Bank payload:

- Raw continuous webcam video
- Large sequences of raw frames
- Uninterpreted image blobs

## Live Multimodal Processing Design

The current websocket bidi pattern is correct and should remain the transport layer:

- Audio arrives from the browser and is sent with `LiveRequestQueue.send_realtime(audio_blob)`.
- Image frames arrive from the browser and are sent with `LiveRequestQueue.send_realtime(image_blob)`.
- Text cues can still be sent with `send_content(...)`.

Processing model:

- Camera preview stays live in the UI.
- The browser sends image input as selected keyframes, not full stored video.
- Best initial mode for the demo: manual `Share` plus optional low-frequency keyframes while the user is speaking.
- The backend forwards those frames to ADK live exactly like the bidi samples.
- The model combines the frame with nearby speech transcription to interpret meaning.

Example:

- User shows hat to camera.
- User says: "This hat is my signature when I want personality."
- The persisted memory is: "User has a signature hat used to add personality to polished outfits."

## Memory Formation Rule

A visual cue should become durable memory only when at least one of these is true:

- The user explicitly explains what the visual item means.
- The agent reflects the visual interpretation back and the user accepts it.
- The visual cue is repeated across sessions and aligns with spoken preference.

This avoids noisy or wrong visual memory.

## Memory Extraction Pipeline

After an important live turn:

- Collect a short transcript window around the image event.
- Collect the associated image frame metadata.
- Generate a compact memory candidate summary.
- Filter for only stable, reusable facts.
- Write the session or the curated summary into Memory Bank.

Recommended memory categories:

- `style_identity`
- `signature_items`
- `comfort_constraints`
- `event_context`
- `visual_style_markers`

Good memory examples:

- "Prefers black as a base color."
- "Uses a black hat as a signature styling move."
- "Avoids itchy fabrics."
- "Overheats on expo floors but needs layers for cold rooms."
- "Wants polished but approachable outfits for Cloud Next."

## Cloud SQL Role In The Demo

Cloud SQL should be the visible proof of structured persistence:

- When the user says "I have a customer dinner tomorrow," write an occasion.
- When the user says "add a lightweight layer to my wishlist," write a wishlist item.
- Those items appear in the existing left panel sections and demonstrate deterministic app state.

Memory Bank should be the visible proof of semantic persistence:

- The left-panel `Memory` section should display retrieved memory summaries.
- In the next session, the agent should naturally reference one Memory Bank fact and one Cloud SQL fact in the same response.

## UI Design In Current App

Center panel:

- Live voice chat remains the main interaction.
- Camera preview remains on-screen.
- The `Share` button becomes the intentional "memory-worthy frame" action.

Left panel:

- `Occasions`, `Wishlist`, `Purchases` represent Cloud SQL-backed state.
- `Memory` represents Memory Bank-backed semantic recall.

Recommended demo-safe UI additions:

- Source badge for structured sections: `Cloud SQL`
- Source badge for memory section: `Memory Bank`
- `New Session` button to force cross-session recall on stage
- Auto-refresh after session end, or keep the existing refresh button as part of the demo flow

## ADK Behavior

The agent should use both memory systems deliberately:

- Always call `get_user_context(...)` at session start for Cloud SQL-backed context.
- Use `PreloadMemoryTool()` to retrieve long-term style memory.
- If the user reveals a structured fact, call a structured tool immediately.
- If the user reveals a durable preference or a visual identity cue, let it become Memory Bank content.
- The agent should explicitly fuse both sources in later responses.

Target recall style:

- "You've got that customer dinner tomorrow, and I remember you like a black base with that statement hat."

## Recommended Demo Run

Session 1:

- "I default to black."
- "This hat is my signature piece when I want personality."
- "I hate itchy fabrics."
- "Expo floor is hot but meeting rooms are freezing."
- "I have a customer dinner tomorrow."
- Show hat to camera and press `Share`.

Expected persistence:

- Memory Bank stores style/comfort/signature-item memories.
- Cloud SQL stores the dinner occasion.
- Optional Cloud SQL wishlist item for a lightweight layer.

Session 2:

- Start a new session.
- Ask: "I'm heading to that dinner tonight. What should I wear?"
- The agent should recall both the structured dinner and the remembered style identity.

## Non-Goals

This design does not try to:

- Store or retrieve full raw video as memory
- Do precise wardrobe recognition
- Use video as a search/archive product
- Solve product recommendation/catalog search in the same milestone

## Implementation Priority

1. Turn on real Vertex AI Memory Bank in `backend/agent/services.py`.
2. Keep Cloud SQL as the source of truth for structured profile/event/wishlist data.
3. Use live audio plus selected image frames, not raw video persistence.
4. Tune the agent prompt so it verbalizes stable preferences clearly.
5. Make the UI visibly show both structured state and memory recall.

## Key Design Decision

Use live video as ephemeral sensory input, not as the stored memory artifact. Persist the extracted meaning in Memory Bank, and persist explicit structured user facts in Cloud SQL.

## Next Step

If needed, this doc can be extended into a more implementation-oriented v2 with:

- exact backend components
- memory topic config
- event flow by step
- a stage-safe demo script mapped to each UI action
