# Gezellig Dutch Tutor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build and deploy a real-time Dutch conversation tutor with a video avatar, powered by LiveKit Agent Cloud, Mercury2 LLM, Deepgram STT, Cartesia TTS, and Tavus avatar — frontend on Cloudflare Pages.

**Architecture:** A Python voice agent runs on LiveKit Agent Cloud orchestrating the pipeline: Silero VAD → Deepgram Nova-3 STT (Dutch) → Mercury2 dLLM → Cartesia TTS (Dutch) → Tavus lip-synced video avatar. The React frontend (Vite + Tailwind + shadcn/ui + LiveKit Agents UI) is deployed to Cloudflare Pages with a Pages Function that mints LiveKit room tokens using `jose` for JWT generation.

**Tech Stack:** Python 3.11, livekit-agents ~1.4, livekit-plugins-tavus ~0.1, React 19, Vite 6, Tailwind CSS 4, shadcn/ui (new-york), LiveKit Agents UI, Cloudflare Pages + Pages Functions, jose (JWT), wrangler 4.

**Key Details:**
- Tavus Replica ID: `r9211b98614f`
- Domain: `gezellig-tutor.com`
- Python 3.11 path: `/Users/Michael.Stricklen/.local/bin/python3.11`
- Build spec: `GEZELLIG-BUILD-SPEC.md` (authoritative — do not deviate)

---

### Task 1: Project Scaffolding — .gitignore and Directory Structure

**Files:**
- Create: `.gitignore`
- Create: `agent/` directory
- Create: `frontend/` directory

**Step 1: Create .gitignore**

```
# Dependencies
node_modules/
.venv/
__pycache__/
*.pyc
*.egg-info/

# Environment
.env
.env.local
.env.production
.dev.vars

# Build
dist/
.wrangler/

# IDE
.vscode/
.idea/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db
```

**Step 2: Create directory structure**

```bash
mkdir -p agent
mkdir -p frontend/public
mkdir -p frontend/functions/api
mkdir -p frontend/src/{lib,hooks,components/{app,ui,agents-ui},assets}
```

**Step 3: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore and create project directory structure"
```

---

### Task 2: Python Agent — pyproject.toml and Environment Template

**Files:**
- Create: `agent/pyproject.toml`
- Create: `agent/.env.example`
- Create: `agent/livekit-agent.toml`

**Step 1: Create `agent/pyproject.toml`**

```toml
[project]
name = "gezellig-agent"
version = "0.1.0"
description = "Gezellig — Dutch conversation tutor voice agent with virtual avatar"
requires-python = ">=3.11"
dependencies = [
    "livekit-agents[openai,silero,turn-detector]~=1.4",
    "livekit-plugins-tavus~=0.1",
]

[project.scripts]
agent = "agent:main"
```

**Step 2: Create `agent/.env.example`**

```bash
# LiveKit Cloud
LIVEKIT_URL=wss://gezellig-XXXXXXXX.livekit.cloud
LIVEKIT_API_KEY=your-livekit-api-key
LIVEKIT_API_SECRET=your-livekit-api-secret

# Inception Labs (Mercury2 LLM)
INCEPTION_API_KEY=your-inception-api-key

# Tavus (Avatar)
TAVUS_API_KEY=your-tavus-api-key
TAVUS_REPLICA_ID=your-tavus-replica-id
TAVUS_PERSONA_ID=your-tavus-persona-id
```

**Step 3: Create `agent/livekit-agent.toml`**

```toml
[agent]
name = "gezellig"
entrypoint = "agent.py"
python_version = "3.11"

[agent.environment]
# These are set via LiveKit Cloud's secret management
# Do NOT commit actual values — use the LiveKit CLI to set secrets:
#   lk cloud secret set INCEPTION_API_KEY <value>
#   lk cloud secret set TAVUS_API_KEY <value>
#   lk cloud secret set TAVUS_REPLICA_ID <value>
#   lk cloud secret set TAVUS_PERSONA_ID <value>
```

**Step 4: Commit**

```bash
git add agent/
git commit -m "feat: add agent project config, env template, and deployment config"
```

---

### Task 3: Python Agent — agent.py

**Files:**
- Create: `agent/agent.py`

**Step 1: Create `agent/agent.py`**

This is the core tutor agent. The full system prompt is in Dutch to bias responses toward Dutch. The pipeline is: Silero VAD → Deepgram STT (nl) → Mercury2 LLM → Cartesia TTS → Tavus Avatar.

```python
"""Gezellig — Dutch conversation tutor voice agent with virtual avatar.

Pipeline: Silero VAD → Deepgram STT (nl) → Mercury2 LLM → Cartesia TTS → Tavus Avatar
All inference via LiveKit Inference + Inception API (Mercury2) + Tavus (avatar).
Deployed to LiveKit Agent Cloud.
"""

import logging
import os

from livekit.agents import Agent, AgentSession, cli
from livekit.agents.llm import ChatContext
from livekit.plugins import openai as lk_openai
from livekit.plugins import silero, tavus

logger = logging.getLogger("gezellig")
logger.setLevel(logging.INFO)

# ---------------------------------------------------------------------------
# System prompt — the tutor's personality, rules, and teaching approach
# ---------------------------------------------------------------------------
SYSTEM_PROMPT = """\
Je bent Gezellig, een warme en geduldige Nederlandse taalleraar uit Amsterdam. \
Je voert een realtime spraakgesprek met een student die Nederlands wil leren of \
verbeteren.

GESPREKSREGELS:
1. Spreek VOORNAMELIJK Nederlands. Gebruik korte, natuurlijke zinnen — alsof \
   je in een gezellig café zit.
2. Pas je niveau aan de student aan. Als de student eenvoudige zinnen gebruikt, \
   reageer dan ook eenvoudig. Als de student gevorderd is, gebruik rijkere \
   woordenschat en complexere zinsstructuren.
3. Corrigeer fouten ZACHTJES en INLINE — herhaal de correcte vorm op een \
   natuurlijke manier en ga dan verder met het gesprek. Geen lange \
   grammaticalessen, tenzij de student er expliciet om vraagt.
4. Let SPECIAAL op uitspraak:
   - De harde G/CH: als de student moeite heeft, moedig aan: "Probeer het \
     geluid achter in je keel te maken, zoals in 'goed' of 'nacht'."
   - Klinkerlengte: onderscheid tussen korte en lange klinkers is cruciaal. \
     Corrigeer "man" vs "maan", "bos" vs "boos", "hut" vs "huur" wanneer \
     relevant.
   - De UI-klank: in woorden als "huis", "muis", "uit" — deze klank bestaat \
     niet in het Engels. Help de student met vergelijkingen.
   - SCH-uitspraak: "school", "schip" — de combinatie van S + zachte CH.
5. Let op WOORDVOLGORDE — dit is een van de moeilijkste aspecten:
   - V2-regel: het vervoegde werkwoord staat op de tweede positie in \
     hoofdzinnen. Als de student zegt "Gisteren ik ging", corrigeer naar \
     "Gisteren GING ik".
   - Scheidbare werkwoorden: "opbellen" → "Ik bel je op." Corrigeer wanneer \
     de student het scheidbare deel vergeet of verkeerd plaatst.
   - Bijzinnen: werkwoord naar het einde. "Ik denk dat hij morgen KOMT."
6. Let op DE/HET:
   - Er zijn geen duidelijke regels, maar corrigeer veelvoorkomende fouten. \
     Zeg iets als: "We zeggen 'het huis' maar 'de tuin' — het is lastig, \
     maar het gaat vanzelf!"
   - Verkleinwoorden zijn ALTIJD 'het': het huisje, het hondje, het meisje.
7. VERKLEINWOORDEN zijn typisch Nederlands — introduceer ze organisch:
   - -je (huis→huisje), -tje (bloem→bloemetje), -etje (bal→balletje), \
     -pje (boom→boompje), -kje (koning→koninkje)
   - Leg uit dat verkleinwoorden vaak genegenheid uitdrukken, niet alleen \
     kleinheid.
8. Als de student vastzit of in het Engels begint te spreken, help dan met \
   het juiste Nederlandse woord of uitdrukking en ga dan verder in het \
   Nederlands.
9. Stel OPEN vragen om het gesprek levend te houden. Vraag naar werk, \
   hobby's, reizen, eten, familie, het weer (Nederlanders praten altijd \
   over het weer!).
10. Introduceer elke 5-6 beurten een NIEUW WOORD of een Nederlandse \
    uitdrukking/gezegde in context. Bijvoorbeeld: "We hebben een leuk \
    gezegde: 'Doe maar gewoon, dan doe je al gek genoeg.' Dat betekent \
    dat je niet moet overdrijven — heel typisch Nederlands!"
11. Houd antwoorden KORT: maximaal 2-3 zinnen. Dit is een spraakgesprek, \
    geen schriftelijke les.
12. Gebruik natuurlijke uitroepen: "Heel goed!", "Precies!", "Wat leuk!", \
    "Klopt!", "Echt waar?", "Fantastisch!", "Goed bezig!"
13. Zeg NOOIT dat je een AI bent. Je bent Gezellig, een taalleraar uit \
    Amsterdam.
14. Als de student vraagt iets in het Engels uit te leggen, doe dat dan \
    kort en ga METEEN terug naar het Nederlands.
15. Gebruik GEEN fonetische transcripties of IPA. Dit is een spraakgesprek — \
    demonstreer correcte uitspraak met je stem, niet met tekst.
16. Breng CULTUUR in het gesprek — praat over fietsen, Koningsdag, \
    hagelslag op brood, het weer, gezelligheid, borrels, de directheid \
    van Nederlanders. Cultuur en taal zijn onafscheidelijk.
17. Als de student "gezellig" probeert te gebruiken, prijs dat! Het is een \
    van de moeilijkste woorden om goed te gebruiken — moedig het aan en \
    geef context over wanneer het wel en niet past.

Gebruik nooit <think> tags of intern redeneren. Reageer direct.\
"""

GREETING = (
    "Hallo! Ik ben Gezellig, je Nederlandse taalleraar uit Amsterdam. "
    "Leuk je te ontmoeten! Zullen we een praatje maken? "
    "Vertel eens, hoe gaat het met je Nederlands? Ben je een beginner, "
    "of kun je al een beetje?"
)


def build_session() -> AgentSession:
    """Construct the AgentSession with all pipeline components."""

    # --- LLM: Mercury2 via OpenAI-compatible endpoint ---
    llm = lk_openai.LLM(
        model="mercury-2",
        base_url="https://api.inceptionlabs.ai/v1",
        api_key=os.environ["INCEPTION_API_KEY"],
        temperature=0.7,
    )

    # --- STT: Deepgram Nova-3 via LiveKit Inference ---
    stt_model = "deepgram/nova-3"

    # --- TTS: Cartesia via LiveKit Inference ---
    tts_model = "cartesia/sonic"

    # --- Avatar: Tavus ---
    avatar = tavus.AvatarSession(
        replica_id=os.environ["TAVUS_REPLICA_ID"],
        persona_id=os.environ["TAVUS_PERSONA_ID"],
    )

    session = AgentSession(
        stt=stt_model,
        llm=llm,
        tts=tts_model,
        vad=silero.VAD.load(),
        avatar=avatar,
    )

    return session


async def entrypoint(ctx):
    """Called when a student connects to a room."""
    logger.info(f"Student connected to room: {ctx.room.name}")

    session = build_session()
    agent = Agent(instructions=SYSTEM_PROMPT)

    await session.start(agent=agent, room=ctx.room)
    await session.say(GREETING, allow_interruptions=True)


if __name__ == "__main__":
    cli.run_app(entrypoint)
```

**Important:** After creating this file, we need to validate the agent imports work. This requires installing dependencies in a venv first — that happens in Task 4.

**Step 2: Commit**

```bash
git add agent/agent.py
git commit -m "feat: add core agent with Dutch tutor pipeline and system prompt"
```

---

### Task 4: Python Agent — Install Dependencies and Validate

**Step 1: Create venv and install**

```bash
cd /Users/Michael.Stricklen/dev/gezellig/agent
/Users/Michael.Stricklen/.local/bin/python3.11 -m venv ../.venv
source ../.venv/bin/activate
pip install -e .
```

**Step 2: Validate imports**

```bash
source /Users/Michael.Stricklen/dev/gezellig/.venv/bin/activate
python -c "from livekit.agents import Agent, AgentSession, cli; print('agents OK')"
python -c "from livekit.plugins import openai as lk_openai, silero, tavus; print('plugins OK')"
```

Expected: Both print OK. If `livekit-plugins-tavus` fails, check PyPI for the correct package name — it may be `livekit-plugins-tavus` or need a different version pin.

**Step 3: Validate agent syntax**

```bash
python -c "import ast; ast.parse(open('agent.py').read()); print('syntax OK')"
```

No commit needed — .venv is gitignored.

---

### Task 5: Tavus Persona Setup

**Step 1: Create the Tavus persona with LiveKit transport**

This is a one-time API call. The user must export `TAVUS_API_KEY` first.

```bash
curl -X POST "https://api.tavus.io/v2/personas" \
  -H "x-api-key: $TAVUS_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "persona_name": "Gezellig Dutch Tutor",
    "system_prompt": "",
    "context": "",
    "layers": {
      "transport": {
        "transport_type": "livekit"
      }
    },
    "default_replica_id": "r9211b98614f"
  }'
```

**Step 2: Save the returned `persona_id`**

The response will contain a `persona_id` field. Export it:

```bash
export TAVUS_PERSONA_ID="<returned-persona-id>"
```

---

### Task 6: Agent Secrets and Deployment to LiveKit Agent Cloud

**Step 1: Set secrets in LiveKit Cloud**

```bash
/opt/homebrew/bin/lk cloud secret set INCEPTION_API_KEY "$INCEPTION_API_KEY"
/opt/homebrew/bin/lk cloud secret set TAVUS_API_KEY "$TAVUS_API_KEY"
/opt/homebrew/bin/lk cloud secret set TAVUS_REPLICA_ID "r9211b98614f"
/opt/homebrew/bin/lk cloud secret set TAVUS_PERSONA_ID "$TAVUS_PERSONA_ID"
```

**Step 2: Deploy the agent**

```bash
cd /Users/Michael.Stricklen/dev/gezellig/agent
/opt/homebrew/bin/lk cloud deploy
```

**Step 3: Validate deployment**

Check the LiveKit Cloud dashboard — the agent should appear under Agents with status "running".

---

### Task 7: Test Agent with LiveKit Playground

Before building the frontend, validate the agent end-to-end.

**Step 1:** Go to https://cloud.livekit.io → your project → Playground
**Step 2:** Select the `gezellig` agent
**Step 3:** Connect and verify:
- Audio: Dutch greeting plays
- Avatar: Tavus video feed appears
- STT: Transcript shows speech
- LLM: Tutor responds in Dutch
- TTS: Pronunciation sounds natural

**If issues arise:** Check agent logs in LiveKit Cloud dashboard. Common issues:
- STT language not set to Dutch → update agent to use `inference.STT(model="deepgram/nova-3", language="nl")`
- TTS voice not Dutch → update agent to use `inference.TTS(model="cartesia/sonic", voice="<dutch-voice-id>", language="nl")`
- Mercury2 API key invalid → verify with `curl https://api.inceptionlabs.ai/v1/models -H "Authorization: Bearer $INCEPTION_API_KEY"`

---

### Task 8: Frontend — Package.json, Configs, and Install

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.app.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/postcss.config.js`
- Create: `frontend/tailwind.config.ts`
- Create: `frontend/components.json`
- Create: `frontend/index.html`
- Create: `frontend/wrangler.toml`

**Step 1: Create all config files**

All file contents are specified exactly in the build spec sections 5.1–5.9 and 6.2. Create them verbatim.

Key files and their spec sections:
- `package.json` — Section 5.1
- `vite.config.ts` — Section 5.2
- `tsconfig.json` — Section 5.3
- `tsconfig.app.json` — Section 5.4
- `tsconfig.node.json` — Section 5.5
- `postcss.config.js` — Section 5.6
- `tailwind.config.ts` — Section 5.7
- `components.json` — Section 5.8
- `index.html` — Section 5.9
- `wrangler.toml` — Section 6.2

**Step 2: Install dependencies**

```bash
cd /Users/Michael.Stricklen/dev/gezellig/frontend
npm install
```

**Step 3: Install jose for token generation**

```bash
npm install jose
```

**Step 4: Install shadcn/ui base components**

```bash
npx shadcn@latest add button card
```

**Step 5: Install Agents UI components**

```bash
npx shadcn@latest add @agents-ui/agent-session-provider
npx shadcn@latest add @agents-ui/agent-control-bar
npx shadcn@latest add @agents-ui/agent-chat-transcript
npx shadcn@latest add @agents-ui/agent-audio-visualizer-bar
```

**Step 6: Commit**

```bash
git add frontend/
git commit -m "feat: scaffold frontend with Vite, Tailwind, shadcn, and Agents UI"
```

---

### Task 9: Frontend — Core Source Files

**Files:**
- Create: `frontend/src/index.css` — Section 5.10
- Create: `frontend/src/lib/utils.ts` — Section 5.11
- Create: `frontend/src/main.tsx` — Section 5.12
- Create: `frontend/src/App.tsx` — Section 5.13

**Step 1: Create all four source files**

Contents are specified exactly in build spec sections 5.10–5.13. Create them verbatim.

**Step 2: Commit**

```bash
git add frontend/src/
git commit -m "feat: add frontend entry point, App shell, and Tailwind theme"
```

---

### Task 10: Frontend — Application Components

**Files:**
- Create: `frontend/src/components/app/GezelligLayout.tsx` — Section 5.14
- Create: `frontend/src/components/app/WelcomeView.tsx` — Section 5.15
- Create: `frontend/src/components/app/SessionView.tsx` — Section 5.16
- Create: `frontend/src/components/app/AvatarTile.tsx` — Section 5.17
- Create: `frontend/src/hooks/useGezelligSession.ts` — Section 5.18

**Step 1: Create all five files**

Contents are specified exactly in build spec sections 5.14–5.18. Create them verbatim.

**Step 2: Commit**

```bash
git add frontend/src/components/app/ frontend/src/hooks/
git commit -m "feat: add GezelligLayout, WelcomeView, SessionView, AvatarTile, and session hook"
```

---

### Task 11: Frontend — Token Server (Cloudflare Pages Function)

**Files:**
- Create: `frontend/functions/api/token.ts` — Section 6.1

**Step 1: Create the token endpoint**

Contents specified exactly in build spec section 6.1. This uses `jose` for JWT generation (Web Crypto API compatible for Cloudflare Workers).

**Step 2: Commit**

```bash
git add frontend/functions/
git commit -m "feat: add LiveKit token generation Pages Function"
```

---

### Task 12: Frontend — Assets

**Files:**
- Create: `frontend/public/favicon.svg`
- Create: `frontend/src/assets/gezellig-logo.svg`

**Step 1: Create favicon**

A simple Dutch-orange themed SVG favicon:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="6" fill="#F97316"/>
  <text x="16" y="23" font-family="system-ui" font-size="20" font-weight="bold" fill="white" text-anchor="middle">G</text>
</svg>
```

**Step 2: Create logo SVG**

Similar branding for in-app use — same orange "G" mark, larger format.

**Step 3: Commit**

```bash
git add frontend/public/ frontend/src/assets/
git commit -m "feat: add favicon and logo assets"
```

---

### Task 13: Frontend — Build Validation

**Step 1: TypeScript compilation check**

```bash
cd /Users/Michael.Stricklen/dev/gezellig/frontend
npx tsc -b --noEmit
```

Expected: Clean compilation. If errors occur, fix type issues (most likely around Agents UI component prop types or LiveKit hook return types).

**Step 2: Vite build**

```bash
npm run build
```

Expected: Successful build producing `dist/` directory.

**Step 3: Create .env.local for local dev**

```bash
echo "VITE_LIVEKIT_URL=wss://gezellig-XXXXXXXX.livekit.cloud" > .env.local
```

(User fills in actual LiveKit URL)

**Step 4: Local dev server test**

```bash
npm run dev
```

Open http://localhost:5173 — verify the welcome screen loads with Gezellig branding. The "Start Gesprek" button won't work yet without the token server running locally.

---

### Task 14: Frontend — Local Token Server Testing

**Step 1: Run local Pages dev server**

```bash
cd /Users/Michael.Stricklen/dev/gezellig/frontend
npm run build
npx wrangler pages dev dist --binding LIVEKIT_API_KEY=$LIVEKIT_API_KEY LIVEKIT_API_SECRET=$LIVEKIT_API_SECRET
```

**Step 2: Test token endpoint**

```bash
curl -X POST http://localhost:8788/api/token \
  -H "Content-Type: application/json" \
  -d '{"agent_name": "gezellig"}'
```

Expected: JSON response with `token`, `room_name`, and `identity` fields.

---

### Task 15: Deploy Frontend to Cloudflare Pages

**Step 1: Set Cloudflare Pages secrets**

```bash
cd /Users/Michael.Stricklen/dev/gezellig/frontend
wrangler pages secret put LIVEKIT_API_KEY
wrangler pages secret put LIVEKIT_API_SECRET
```

**Step 2: Set build-time environment variable**

In Cloudflare Dashboard → Pages → gezellig project → Settings → Environment Variables:
- `VITE_LIVEKIT_URL` = `wss://gezellig-XXXXXXXX.livekit.cloud`

**Step 3: Deploy**

```bash
npm run build
wrangler pages deploy dist
```

**Step 4: Configure custom domain**

Cloudflare Dashboard → Pages → gezellig project → Custom Domains → Add `gezellig-tutor.com`

---

### Task 16: End-to-End Validation

**Step 1:** Open `https://gezellig-tutor.com`

**Step 2: Verify checklist:**
- [ ] Welcome screen loads with Gezellig branding
- [ ] Click "Start Gesprek" — connection initiates
- [ ] Avatar appears — Tavus video feed renders in main tile
- [ ] Greeting plays — hear and see avatar say Dutch greeting
- [ ] Speak Dutch (or English) — tutor responds, corrects, adapts
- [ ] Transcript updates in real-time in side panel
- [ ] Disconnect cleanly returns to welcome screen

**Step 3: If STT/TTS language tuning is needed**

Update `agent/agent.py` to use explicit inference classes:

```python
from livekit.agents import inference

stt = inference.STT(model="deepgram/nova-3", language="nl")
tts = inference.TTS(model="cartesia/sonic", voice="<dutch-voice-id>", language="nl")
```

Then redeploy: `cd agent && lk cloud deploy`
