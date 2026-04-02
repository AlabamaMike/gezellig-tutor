# Gezellig — Dutch Conversation Tutor

A real-time Dutch language conversation tutor with a lifelike video avatar. Students speak Dutch (or attempt to) through a browser, and Gezellig responds in Dutch via a lip-synced video avatar — correcting pronunciation and grammar inline, introducing vocabulary organically, and keeping conversation flowing naturally.

The name *gezellig* is an untranslatable Dutch word meaning cozy warmth and togetherness — it *is* the experience.

## Architecture

```
Browser (Cloudflare Pages)
  │  WebRTC
  ▼
LiveKit Cloud
  ├── Silero VAD          Voice activity detection
  ├── Deepgram Nova-3     Speech-to-text (Dutch)
  ├── Mercury2 (dLLM)     Diffusion LLM for ultra-low-latency responses
  ├── Cartesia Sonic       Text-to-speech (Dutch voice)
  └── Tavus                Lip-synced video avatar
```

| Component | Service | Role |
|-----------|---------|------|
| Frontend | Cloudflare Pages | Vite + React app with LiveKit Agents UI |
| Token Server | Cloudflare Pages Function | Mints LiveKit JWT tokens for room access |
| Media Transport | LiveKit Cloud | WebRTC relay, global edge network |
| Agent Runtime | LiveKit Agent Cloud | Hosts Python agent, manages sessions |
| STT | Deepgram Nova-3 (via LiveKit Inference) | Dutch speech recognition, streaming |
| LLM | Inception Labs Mercury2 | Diffusion LLM, ultra-low-latency generation |
| TTS | Cartesia Sonic (via LiveKit Inference) | Dutch voice synthesis, streaming |
| Avatar | Tavus | Real-time lip-synced video avatar |
| VAD | Silero (bundled in agent) | Voice activity detection |

**Latency target:** < 1000ms end-to-end (student stops speaking to avatar starts responding).

## Project Structure

```
gezellig/
├── agent/                      # Python agent — deployed to LiveKit Agent Cloud
│   ├── agent.py                # Main agent with Dutch tutor system prompt
│   ├── pyproject.toml          # Python dependencies
│   ├── requirements.txt        # Pinned deps for Docker build
│   ├── livekit.toml            # LiveKit Agent Cloud deployment config
│   ├── Dockerfile              # Agent container build
│   └── .env.example            # Environment variable template
│
└── frontend/                   # React app — deployed to Cloudflare Pages
    ├── package.json
    ├── vite.config.ts
    ├── tailwind.config.ts
    ├── wrangler.toml           # Cloudflare Pages config
    ├── functions/api/
    │   └── token.ts            # LiveKit token generation endpoint
    └── src/
        ├── App.tsx
        ├── components/
        │   ├── app/            # Custom application components
        │   ├── agents-ui/      # LiveKit Agents UI components (via shadcn)
        │   └── ui/             # Base shadcn/ui components
        └── hooks/
```

## Prerequisites

### Accounts and API Keys

| Service | What You Need | Sign Up |
|---------|---------------|---------|
| LiveKit Cloud | URL, API key, API secret | https://cloud.livekit.io |
| Inception Labs | API key (10M free tokens) | https://www.inceptionlabs.ai |
| Tavus | API key, replica ID, persona ID | https://www.tavus.io |
| Cloudflare | Pages-enabled account | https://dash.cloudflare.com |

### Tools

- **Python 3.11+**
- **Node.js 20+**
- **LiveKit CLI** (`lk`): https://docs.livekit.io/home/cli/
- **Wrangler CLI**: `npm install -g wrangler`

## Setup

### 1. Clone and Configure

```bash
git clone https://github.com/AlabamaMike/gezellig-tutor.git
cd gezellig-tutor
```

### 2. Tavus Persona

Create a Tavus persona with LiveKit transport — either via the Tavus dashboard or API:

```bash
curl -X POST "https://api.tavus.io/v2/personas" \
  -H "x-api-key: $TAVUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "persona_name": "Gezellig Dutch Tutor",
    "system_prompt": "You are a Dutch language tutor named Gezellig.",
    "context": "",
    "layers": { "transport": { "transport_type": "livekit" } },
    "default_replica_id": "YOUR_REPLICA_ID"
  }'
```

Save the returned `persona_id`.

### 3. Agent Setup

```bash
cd agent

# Create virtual environment
python3.11 -m venv ../.venv
source ../.venv/bin/activate
pip install -e .

# Copy and fill in environment variables
cp .env.example .env
# Edit .env with your actual credentials
```

### 4. Authenticate LiveKit CLI

```bash
lk cloud auth
```

### 5. Deploy Agent

```bash
cd agent

# Set secrets
lk agent update-secrets --id YOUR_AGENT_ID \
  --secrets "INCEPTION_API_KEY=your-key" \
  --secrets "TAVUS_API_KEY=your-key" \
  --secrets "TAVUS_REPLICA_ID=your-replica-id" \
  --secrets "TAVUS_PERSONA_ID=your-persona-id"

# Deploy (first time: lk agent create, subsequent: lk agent deploy)
lk agent deploy --region us-east -y .
```

Verify the agent is running:

```bash
lk agent status --id YOUR_AGENT_ID
```

### 6. Test Agent

Go to https://cloud.livekit.io → your project → **Playground** → select the `gezellig` agent → Connect. Verify you hear the Dutch greeting and see the avatar.

### 7. Frontend Setup

```bash
cd frontend
npm install

# Create local env
echo "VITE_LIVEKIT_URL=wss://YOUR-PROJECT.livekit.cloud" > .env.local

# Local development
npm run dev
```

For the token endpoint to work locally:

```bash
npm run build
npx wrangler pages dev dist \
  --binding LIVEKIT_API_KEY=your-key \
  --binding LIVEKIT_API_SECRET=your-secret
```

### 8. Deploy Frontend

```bash
cd frontend

# Create Cloudflare Pages project (first time only)
wrangler pages project create gezellig --production-branch main

# Set secrets
wrangler pages secret put LIVEKIT_API_KEY --project-name gezellig
wrangler pages secret put LIVEKIT_API_SECRET --project-name gezellig

# Set VITE_LIVEKIT_URL as a build-time env var in Cloudflare Dashboard:
# Pages → gezellig → Settings → Environment Variables

# Build and deploy
VITE_LIVEKIT_URL=wss://YOUR-PROJECT.livekit.cloud npm run build
wrangler pages deploy dist --project-name gezellig
```

### 9. Custom Domain (Optional)

Cloudflare Dashboard → Pages → gezellig → Custom Domains → Add your domain.

## Environment Variables

### Agent (LiveKit Agent Cloud)

| Variable | How to Set |
|----------|------------|
| `LIVEKIT_URL` | Automatic (set by Agent Cloud) |
| `LIVEKIT_API_KEY` | Automatic (set by Agent Cloud) |
| `LIVEKIT_API_SECRET` | Automatic (set by Agent Cloud) |
| `INCEPTION_API_KEY` | `lk agent update-secrets` |
| `TAVUS_API_KEY` | `lk agent update-secrets` |
| `TAVUS_REPLICA_ID` | `lk agent update-secrets` |
| `TAVUS_PERSONA_ID` | `lk agent update-secrets` |

### Frontend (Cloudflare Pages)

| Variable | Where | How to Set |
|----------|-------|------------|
| `VITE_LIVEKIT_URL` | Build-time | Cloudflare Dashboard → Environment Variables |
| `LIVEKIT_API_KEY` | Pages Function secret | `wrangler pages secret put` |
| `LIVEKIT_API_SECRET` | Pages Function secret | `wrangler pages secret put` |

## Voice Configuration

The agent uses a Dutch Cartesia voice via LiveKit Inference. To change the voice:

1. Browse voices at https://play.cartesia.ai/voices
2. Filter by Dutch language
3. Copy the voice ID (UUID)
4. Update `agent/agent.py`:

```python
tts="cartesia/sonic:YOUR-VOICE-UUID"
```

The STT is configured for Dutch recognition:

```python
stt="deepgram/nova-3:nl"
```

## How It Works

1. **Student connects** via browser — the frontend requests a LiveKit room token from the Cloudflare Pages Function
2. **LiveKit dispatches** the `gezellig` agent to the room
3. **Tavus avatar** joins as a separate participant, publishing a video track
4. **Student speaks** — Silero VAD detects speech, Deepgram transcribes Dutch audio
5. **Mercury2** generates a response (diffusion LLM for ultra-low latency)
6. **Cartesia** synthesizes Dutch speech from the response
7. **Tavus** lip-syncs the avatar video to the synthesized audio
8. The agent corrects pronunciation, teaches grammar, introduces vocabulary, and weaves in Dutch culture — all in real-time conversation

## Tech Stack

- **Agent**: Python 3.11, livekit-agents 1.5.x, livekit-plugins-tavus
- **Frontend**: React 19, Vite 6, Tailwind CSS 4, shadcn/ui, LiveKit Agents UI
- **Hosting**: Cloudflare Pages (frontend), LiveKit Agent Cloud (agent)
- **AI Services**: Deepgram Nova-3 (STT), Mercury2 (LLM), Cartesia Sonic (TTS), Tavus (avatar)

## License

Private — not for redistribution.
