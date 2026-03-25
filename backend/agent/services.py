import os
from pathlib import Path

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

from google.adk.runners import Runner
from google.adk.memory import InMemoryMemoryService
from google.adk.sessions import InMemorySessionService

from agent.agent import root_agent

USE_MEMORY_BANK = os.getenv("USE_MEMORY_BANK", "false").lower() == "true"
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT") or os.getenv("PROJECT_ID", "")
REGION = os.getenv("GOOGLE_CLOUD_LOCATION") or os.getenv("REGION") or os.getenv("LOCATION", "us-central1")
AGENT_ENGINE_ID = os.getenv("AGENT_ENGINE_ID", "")
MEMORY_BANK_ENGINE_NAME = os.getenv("MEMORY_BANK_ENGINE_NAME", "fashionmind-demo")


def _resolve_agent_engine_id() -> str:
    if AGENT_ENGINE_ID:
        return AGENT_ENGINE_ID

    if not PROJECT_ID:
        print("⚠️ Memory Bank requested but PROJECT_ID is not configured.")
        return ""

    try:
        import vertexai
        from agent.memory_bank_config import build_memory_bank_config

        vertexai.init(project=PROJECT_ID, location=REGION)
        client = vertexai.Client(project=PROJECT_ID, location=REGION)

        for engine in client.agent_engines.list():
            if getattr(engine, "display_name", "") == MEMORY_BANK_ENGINE_NAME:
                engine_name = engine.api_resource.name.split("/")[-1]
                print(f"🧠 Reusing Memory Bank Agent Engine: {engine_name}")
                return engine_name

        print(f"🧠 Creating Memory Bank Agent Engine: {MEMORY_BANK_ENGINE_NAME}")
        agent_engine = client.agent_engines.create(
            config={
                "display_name": MEMORY_BANK_ENGINE_NAME,
                "context_spec": {
                    "memory_bank_config": build_memory_bank_config(PROJECT_ID, REGION),
                },
            }
        )
        engine_name = agent_engine.api_resource.name.split("/")[-1]
        print(f"🧠 Created Memory Bank Agent Engine: {engine_name}")
        return engine_name
    except Exception as exc:
        print(f"⚠️ Failed to initialize Vertex AI Memory Bank: {exc}")
        return ""


if USE_MEMORY_BANK:
    resolved_agent_engine_id = _resolve_agent_engine_id()
else:
    resolved_agent_engine_id = ""

# Always use InMemorySessionService — VertexAiSessionService calls append_event on every
# live audio event (per-chunk), adding Vertex AI round-trip latency to every exchange
# and causing OAuth token refresh failures mid-stream.
session_service = InMemorySessionService()

if USE_MEMORY_BANK and resolved_agent_engine_id:
    from google.adk.memory import VertexAiMemoryBankService

    memory_service = VertexAiMemoryBankService(
        project=PROJECT_ID,
        location=REGION,
        agent_engine_id=resolved_agent_engine_id,
    )
    print(f"🧠 Memory Bank: enabled (Vertex AI) — engine {resolved_agent_engine_id}")
else:
    memory_service = InMemoryMemoryService()
    if USE_MEMORY_BANK:
        print("🧠 Memory Bank: requested but unavailable — falling back to InMemory.")
    else:
        print("🧠 Memory Bank: disabled (InMemory — local dev mode)")

runner = Runner(
    agent=root_agent,
    session_service=session_service,
    memory_service=memory_service,
    app_name="fashionmind",
)
