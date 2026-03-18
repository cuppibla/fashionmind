#!/bin/bash
if [ "$#" -ne 2 ]; then
    echo "Usage: $0 <PROJECT_ID> <REGION>"
    exit 1
fi

PROJECT_ID=$1
REGION=$2

echo "Creating CloudSQL instance..."
gcloud sql instances create fashionmind-db \
 --database-version=POSTGRES_15 \
 --tier=db-f1-micro \
 --region=$REGION \
 --project=$PROJECT_ID

gcloud sql databases create fashionmind \
 --instance=fashionmind-db \
 --project=$PROJECT_ID

gcloud sql users create fashionmind_user \
 --instance=fashionmind-db \
 --password=fashionmind_pass \
 --project=$PROJECT_ID

echo "Setting up Vertex AI Agent Engine..."
AGENT_ENGINE_ID=$(python3 -c "
import vertexai
from vertexai.preview import reasoning_engines
vertexai.init(project='$PROJECT_ID', location='$REGION')
app = reasoning_engines.ReasoningEngine.create(
 reasoning_engines.AdkApp(agent=None, enable_tracing=True),
 display_name='fashionmind-agent-engine',
 requirements=['google-adk>=1.0.0', 'google-cloud-aiplatform']
)
print(app.resource_name.split('/')[-1])
")

echo "Writing backend/.env..."
mkdir -p backend
cat << ENV_EOF > backend/.env
DATABASE_URL=postgresql+asyncpg://fashionmind_user:fashionmind_pass@/fashionmind?host=/cloudsql/$PROJECT_ID:$REGION:fashionmind-db
PROJECT_ID=$PROJECT_ID
REGION=$REGION
AGENT_ENGINE_ID=$AGENT_ENGINE_ID
GOOGLE_GENAI_USE_VERTEXAI=TRUE
USE_MEMORY_BANK=true
DEMO_AGENT_MODEL=gemini-live-2.5-flash-native-audio
ENV_EOF

echo "✅ Setup complete. AGENT_ENGINE_ID=$AGENT_ENGINE_ID"
