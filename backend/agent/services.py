import os

from dotenv import load_dotenv
load_dotenv()

from google.adk import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.memory import InMemoryMemoryService

from agent.agent import root_agent

USE_MEMORY_BANK = os.getenv("USE_MEMORY_BANK", "false").lower() == "true"
AGENT_ENGINE_ID = os.getenv("AGENT_ENGINE_ID", "")
PROJECT_ID = os.getenv("PROJECT_ID", "")
REGION = os.getenv("REGION", "us-central1")

if USE_MEMORY_BANK and AGENT_ENGINE_ID:
    from google.adk.sessions import VertexAiSessionService
    from google.adk.memory import VertexAiMemoryBankService

    session_service = VertexAiSessionService(
        project=PROJECT_ID,
        location=REGION,
        agent_engine_id=AGENT_ENGINE_ID,
    )
    memory_service = VertexAiMemoryBankService(
        project=PROJECT_ID,
        location=REGION,
        agent_engine_id=AGENT_ENGINE_ID,
    )
    print(f"🧠 Memory Bank: enabled (Vertex AI) — engine {AGENT_ENGINE_ID}")
else:
    session_service = InMemorySessionService()
    memory_service = InMemoryMemoryService()
    print("🧠 Memory Bank: disabled (InMemory — local dev mode)")

runner = Runner(
    agent=root_agent,
    session_service=session_service,
    memory_service=memory_service,
    app_name="fashionmind",
)
