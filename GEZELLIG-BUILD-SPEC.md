# Gezellig — Build Specification

## Document Purpose

This is a complete implementation spec for **Gezellig**, a real-time Dutch language conversation tutor with a virtual avatar. A developer (or Claude Code agent) should be able to follow this sequentially and produce a fully deployed, working application. Every decision has been made — do not deviate from the architecture, versions, ports, or configuration unless a step explicitly fails.

The goal: a real-time Dutch conversation tutor you can see and talk to through a browser. The student speaks in Dutch (or attempts to), and "Gezellig" responds in Dutch via a lifelike video avatar — correcting pronunciation and grammar inline, introducing new vocabulary organically, and keeping conversation flowing naturally. The name "Gezellig" is an untranslatable Dutch word meaning cozy warmth and togetherness — it *is* the experience.

This project differs from our prior Italian (Marco) and Mandarin (Ni Hao Laoshi) tutors in three major ways:

1. **Fully cloud-hosted** — no DGX Spark, no self-hosted inference
2. **Virtual avatar** — video interaction via Tavus, not audio-only
3. **Diffusion LLM** — Mercury2 from InceptionLabs for ultra-low-latency responses

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     CLOUDFLARE EDGE                         │
│                                                             │
│  ┌─────────────────┐    ┌────────────────────────────────┐  │
│  │ Cloudflare Pages │    │ Pages Function: /api/token     │  │
│  │ Vite + React     │    │ Mints LiveKit room tokens      │  │
│  │ Agents UI        │    │                                │  │
│  │ Tailwind/shadcn  │    └────────────────────────────────┘  │
│  └────────┬─────────┘                                       │
│           │ WebRTC                                          │
└───────────┼─────────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────────┐
│                   LIVEKIT CLOUD                             │
│                                                             │
│  ┌──────────────────┐  ┌─────────────────────────────────┐  │
│  │ Media Server      │  │ Agent Cloud                     │  │
│  │ WebRTC transport  │  │ Python agent process            │  │
│  │ Global edge       │  │ Auto-scaling sessions           │  │
│  └──────────────────┘  │                                 │  │
│                        │  Pipeline:                       │  │
│  ┌──────────────────┐  │  Silero VAD                      │  │
│  │ LiveKit Inference │  │  → Deepgram Nova-3 (STT, nl)    │  │
│  │ Deepgram (STT)   │  │  → Mercury2 (LLM)               │  │
│  │ Cartesia (TTS)   │  │  → Cartesia (TTS, nl)           │  │
│  └──────────────────┘  │  → Tavus Avatar (video)          │  │
│                        └─────────────────────────────────┘  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
            │                              │
┌───────────▼──────────┐    ┌──────────────▼──────────────────┐
│ INCEPTION API        │    │ TAVUS                           │
│ Mercury2 dLLM        │    │ Avatar generation server        │
│ OpenAI-compatible    │    │ Joins room as participant       │
│ api.inceptionlabs.ai │    │ Lip-synced video from TTS audio │
└──────────────────────┘    └─────────────────────────────────┘
```

### 1.1 Component Summary

| Component | Service | Role |
|-----------|---------|------|
| Frontend | Cloudflare Pages | Vite + React app with LiveKit Agents UI components |
| Token Server | Cloudflare Pages Function | Mints LiveKit JWT tokens for room access |
| Media Transport | LiveKit Cloud | WebRTC relay, global edge network |
| Agent Runtime | LiveKit Agent Cloud | Hosts Python agent, manages sessions |
| STT | LiveKit Inference (Deepgram Nova-3) | Dutch speech recognition, streaming |
| LLM | Inception API (Mercury2) | Diffusion LLM, ultra-low-latency response generation |
| TTS | LiveKit Inference (Cartesia) | Dutch voice synthesis, streaming |
| Avatar | Tavus | Real-time lip-synced video avatar |
| VAD | Silero (bundled in agent) | Voice activity detection |

### 1.2 Latency Budget

Target: **< 1000ms** end-to-end (student stops speaking → avatar starts responding)

| Stage | Target | Notes |
|-------|--------|-------|
| VAD → STT final transcript | ~200-300ms | Deepgram streaming, Dutch language model |
| STT → LLM first token | ~50-100ms | Mercury2 parallel diffusion generation |
| LLM → TTS first audio chunk | ~100-150ms | Cartesia streaming synthesis |
| TTS → Avatar first video frame | ~100-200ms | Tavus real-time lip sync |
| **Total** | **~450-750ms** | Well within 1s budget |

---

## 2. Prerequisites and Accounts

Before beginning, set up accounts and gather credentials for each service.

### 2.1 LiveKit Cloud

1. Create account at https://cloud.livekit.io
2. Create a new project (name: `gezellig`)
3. Note your:
   - **LIVEKIT_URL** — `wss://gezellig-XXXXXXXX.livekit.cloud`
   - **LIVEKIT_API_KEY** — from project Settings → Keys
   - **LIVEKIT_API_SECRET** — from project Settings → Keys
4. Ensure your plan supports Agent Cloud deployments and LiveKit Inference

### 2.2 Inception Labs (Mercury2)

1. Create account at https://www.inceptionlabs.ai
2. Navigate to API Keys, create a new key
3. Note your **INCEPTION_API_KEY**
4. New accounts receive 10 million free tokens
5. Verify access: `curl https://api.inceptionlabs.ai/v1/models -H "Authorization: Bearer $INCEPTION_API_KEY"`

### 2.3 Tavus (Avatar)

1. Create account at https://www.tavus.io
2. Get your **TAVUS_API_KEY** from the dashboard
3. Select or create a **Replica** — this is the visual appearance of your avatar
   - Choose a stock replica for quick start, or create a custom one
   - Note the **replica_id**
4. Create a **Persona** with LiveKit transport configured (see Section 4.4)
   - Note the **persona_id**

### 2.4 Cloudflare

1. Log in to your Cloudflare dashboard
2. Choose a domain for the app (e.g., `gezellig.yourdomain.com`)
3. Ensure you have Cloudflare Pages enabled
4. Install Wrangler CLI: `npm install -g wrangler`
5. Authenticate: `wrangler login`

---

## 3. Project Structure

```
gezellig/
├── README.md
├── .gitignore
│
├── agent/                          # Python agent — deployed to LiveKit Agent Cloud
│   ├── agent.py                    # Main agent entry point
│   ├── pyproject.toml              # Python dependencies
│   ├── .env.example                # Environment variable template
│   └── livekit-agent.toml          # LiveKit Agent Cloud deployment config
│
└── frontend/                       # React app — deployed to Cloudflare Pages
    ├── package.json
    ├── vite.config.ts
    ├── tsconfig.json
    ├── tsconfig.app.json
    ├── tsconfig.node.json
    ├── tailwind.config.ts
    ├── postcss.config.js
    ├── components.json             # shadcn/ui + Agents UI registry config
    ├── index.html
    ├── wrangler.toml               # Cloudflare Pages config
    ├── public/
    │   └── favicon.svg
    ├── functions/                   # Cloudflare Pages Functions
    │   └── api/
    │       └── token.ts            # LiveKit token generation endpoint
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── index.css               # Tailwind base + Gezellig theme
        ├── lib/
        │   └── utils.ts            # shadcn cn() utility
        ├── hooks/
        │   └── useGezelligSession.ts
        ├── components/
        │   ├── agents-ui/          # Installed via shadcn CLI (Agents UI)
        │   │   ├── agent-session-provider.tsx
        │   │   ├── agent-control-bar.tsx
        │   │   ├── agent-chat-transcript.tsx
        │   │   └── agent-audio-visualizer-bar.tsx
        │   ├── ui/                 # Installed via shadcn CLI (base shadcn/ui)
        │   │   ├── button.tsx
        │   │   └── card.tsx
        │   └── app/                # Custom application components
        │       ├── GezelligLayout.tsx
        │       ├── WelcomeView.tsx
        │       ├── SessionView.tsx
        │       └── AvatarTile.tsx
        └── assets/
            └── gezellig-logo.svg
```

---

## 4. Agent Implementation (Python)

### 4.1 `agent/pyproject.toml`

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

### 4.2 `agent/.env.example`

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

### 4.3 `agent/livekit-agent.toml`

This is the deployment configuration for LiveKit Agent Cloud.

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

### 4.4 Tavus Persona Setup

Before deploying the agent, create a Tavus persona configured for LiveKit transport. Run this once:

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
    "default_replica_id": "'$TAVUS_REPLICA_ID'"
  }'
```

Note the returned `persona_id` and set it as `TAVUS_PERSONA_ID`.

### 4.5 `agent/agent.py`

This is the core of the tutor. The system prompt is written primarily in Dutch to bias the LLM toward Dutch-language responses.

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
    # Pass as string descriptor — LiveKit Inference handles the connection
    stt_model = "deepgram/nova-3"

    # --- TTS: Cartesia via LiveKit Inference ---
    # Dutch voice — Cartesia's Dutch female voice
    # Check available voices at https://play.cartesia.ai/
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

**Important implementation notes:**

1. **STT language configuration**: Deepgram Nova-3 via LiveKit Inference. If the string descriptor does not accept a language parameter directly, use the inference module class:
   ```python
   from livekit.agents import inference

   stt = inference.STT(model="deepgram/nova-3", language="nl")
   ```

2. **TTS voice selection**: Cartesia Sonic via LiveKit Inference. To specify a Dutch voice:
   ```python
   tts = inference.TTS(model="cartesia/sonic", voice="<dutch-voice-id>")
   ```
   Browse https://play.cartesia.ai/ for Dutch voice IDs. Look for voices tagged with `nl` language support. If a native Dutch voice is unavailable, use a multilingual voice with Dutch capability.

3. **Mercury2 streaming**: Mercury2 supports standard OpenAI-compatible streaming (`stream=True`). The LiveKit OpenAI plugin handles this automatically. Mercury2 also exposes a `reasoning_effort` parameter (values: `instant`, `low`, `medium`, `high`). For voice conversation, use `instant` or `low` to minimize latency:
   ```python
   llm = lk_openai.LLM(
       model="mercury-2",
       base_url="https://api.inceptionlabs.ai/v1",
       api_key=os.environ["INCEPTION_API_KEY"],
       temperature=0.7,
       model_options={"reasoning_effort": "instant"},
   )
   ```

4. **Tavus avatar session**: The `AvatarSession` is passed directly to `AgentSession`. Tavus joins the LiveKit room as a separate participant and publishes its video track. The frontend simply subscribes to this video track like any other participant. No special video handling is needed on the agent side.

---

## 5. Frontend Implementation (React + Vite)

### 5.1 `frontend/package.json`

```json
{
  "name": "gezellig-frontend",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "deploy": "wrangler pages deploy dist",
    "setup:agents-ui": "npx shadcn@latest add @agents-ui/agent-session-provider @agents-ui/agent-control-bar @agents-ui/agent-chat-transcript @agents-ui/agent-audio-visualizer-bar"
  },
  "dependencies": {
    "@livekit/components-react": "^2.9.0",
    "livekit-client": "^2.9.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.6.0",
    "class-variance-authority": "^0.7.1"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250310.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@vitejs/plugin-react": "^4.4.0",
    "autoprefixer": "^10.4.21",
    "postcss": "^8.5.0",
    "tailwindcss": "^4.0.0",
    "typescript": "^5.7.0",
    "vite": "^6.2.0",
    "wrangler": "^4.0.0"
  }
}
```

### 5.2 `frontend/vite.config.ts`

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

### 5.3 `frontend/tsconfig.json`

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

### 5.4 `frontend/tsconfig.app.json`

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
```

### 5.5 `frontend/tsconfig.node.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true
  },
  "include": ["vite.config.ts"]
}
```

### 5.6 `frontend/postcss.config.js`

```javascript
export default {
  plugins: {
    "@tailwindcss/postcss": {},
    autoprefixer: {},
  },
};
```

### 5.7 `frontend/tailwind.config.ts`

```typescript
import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Gezellig brand — inspired by Dutch orange + canal house warmth
        gezellig: {
          50: "#FFF7ED",
          100: "#FFEDD5",
          200: "#FED7AA",
          300: "#FDBA74",
          400: "#FB923C",
          500: "#F97316", // Primary — Dutch orange
          600: "#EA580C",
          700: "#C2410C",
          800: "#9A3412",
          900: "#7C2D12",
        },
        canal: {
          50: "#F0F9FF",
          100: "#E0F2FE",
          200: "#BAE6FD",
          300: "#7DD3FC",
          400: "#38BDF8",
          500: "#0EA5E9", // Accent — canal blue
          600: "#0284C7",
          700: "#0369A1",
          800: "#075985",
          900: "#0C4A6E",
        },
      },
      fontFamily: {
        sans: ['"Inter"', "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
```

### 5.8 `frontend/components.json`

This configures shadcn/ui and the Agents UI registry.

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "src/index.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": ""
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "registries": {
    "@agents-ui": "https://livekit.io/ui/r/{name}.json"
  }
}
```

### 5.9 `frontend/index.html`

```html
<!doctype html>
<html lang="en" class="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Gezellig — Dutch Language Tutor</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
  </head>
  <body class="bg-neutral-950 text-neutral-50 antialiased">
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

### 5.10 `frontend/src/index.css`

```css
@import "tailwindcss";

@layer base {
  :root {
    --background: 0 0% 3.9%;
    --foreground: 0 0% 98%;
    --card: 0 0% 6%;
    --card-foreground: 0 0% 98%;
    --primary: 24.6 95% 53.1%;
    --primary-foreground: 0 0% 98%;
    --secondary: 0 0% 14.9%;
    --secondary-foreground: 0 0% 98%;
    --muted: 0 0% 14.9%;
    --muted-foreground: 0 0% 63.9%;
    --accent: 199 89% 48%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --border: 0 0% 14.9%;
    --ring: 24.6 95% 53.1%;
    --radius: 0.75rem;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}
```

### 5.11 `frontend/src/lib/utils.ts`

```typescript
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

### 5.12 `frontend/src/main.tsx`

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
```

### 5.13 `frontend/src/App.tsx`

```tsx
import { useState, useCallback } from "react";
import { TokenSource } from "livekit-client";
import { AgentSessionProvider } from "@/components/agents-ui/agent-session-provider";
import { GezelligLayout } from "@/components/app/GezelligLayout";
import { WelcomeView } from "@/components/app/WelcomeView";
import { SessionView } from "@/components/app/SessionView";

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;
const AGENT_NAME = "gezellig";

function App() {
  const [isConnected, setIsConnected] = useState(false);

  // Token source — fetches a LiveKit JWT from our Cloudflare Pages Function
  const tokenSource: TokenSource = useCallback(async () => {
    const response = await fetch("/api/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_name: AGENT_NAME }),
    });

    if (!response.ok) {
      throw new Error("Failed to get token");
    }

    const data = await response.json();
    return {
      url: LIVEKIT_URL,
      token: data.token,
      roomName: data.room_name,
    };
  }, []);

  return (
    <AgentSessionProvider tokenSource={tokenSource}>
      <GezelligLayout>
        {isConnected ? (
          <SessionView onDisconnect={() => setIsConnected(false)} />
        ) : (
          <WelcomeView onConnect={() => setIsConnected(true)} />
        )}
      </GezelligLayout>
    </AgentSessionProvider>
  );
}

export default App;
```

### 5.14 `frontend/src/components/app/GezelligLayout.tsx`

```tsx
import type { ReactNode } from "react";

interface GezelligLayoutProps {
  children: ReactNode;
}

export function GezelligLayout({ children }: GezelligLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <header className="mb-8 text-center">
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="text-gezellig-500">Gezellig</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Je Nederlandse taalleraar — Your Dutch Language Tutor
        </p>
      </header>
      <main className="w-full max-w-4xl">{children}</main>
    </div>
  );
}
```

### 5.15 `frontend/src/components/app/WelcomeView.tsx`

```tsx
import { useSession } from "@livekit/components-react";

interface WelcomeViewProps {
  onConnect: () => void;
}

export function WelcomeView({ onConnect }: WelcomeViewProps) {
  const session = useSession();

  const handleStart = async () => {
    try {
      await session.connect();
      onConnect();
    } catch (error) {
      console.error("Failed to connect:", error);
    }
  };

  return (
    <div className="mx-auto max-w-lg rounded-2xl border border-border bg-card p-8 text-center shadow-xl">
      <div className="mb-6">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-gezellig-500/10">
          <span className="text-4xl">🇳🇱</span>
        </div>
        <h2 className="text-2xl font-semibold">Klaar om te oefenen?</h2>
        <p className="mt-2 text-muted-foreground">
          Ready to practice? Gezellig will adapt to your level — from complete
          beginner to advanced. Just start talking!
        </p>
      </div>

      <div className="mb-6 rounded-lg bg-secondary/50 p-4 text-left text-sm">
        <p className="font-medium text-gezellig-400">What to expect:</p>
        <ul className="mt-2 space-y-1 text-muted-foreground">
          <li>• Face-to-face video conversation with your tutor</li>
          <li>• Gentle pronunciation and grammar corrections</li>
          <li>• New vocabulary introduced naturally in context</li>
          <li>• Cultural insights woven into every conversation</li>
        </ul>
      </div>

      <button
        onClick={handleStart}
        className="w-full rounded-xl bg-gezellig-500 px-6 py-3 font-semibold text-white transition-colors hover:bg-gezellig-600 active:bg-gezellig-700"
      >
        Start Gesprek — Begin Conversation
      </button>
    </div>
  );
}
```

### 5.16 `frontend/src/components/app/SessionView.tsx`

```tsx
import {
  VideoTrack,
  useAgent,
  useSession,
  useSessionContext,
} from "@livekit/components-react";
import { AgentControlBar } from "@/components/agents-ui/agent-control-bar";
import { AgentChatTranscript } from "@/components/agents-ui/agent-chat-transcript";
import { AgentAudioVisualizerBar } from "@/components/agents-ui/agent-audio-visualizer-bar";
import { AvatarTile } from "./AvatarTile";

interface SessionViewProps {
  onDisconnect: () => void;
}

export function SessionView({ onDisconnect }: SessionViewProps) {
  const session = useSession();
  const agent = useAgent();

  const handleDisconnect = async () => {
    await session.disconnect();
    onDisconnect();
  };

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Avatar / Video Column */}
      <div className="flex-1">
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          <AvatarTile />
          <div className="p-4">
            <AgentAudioVisualizerBar />
          </div>
        </div>
      </div>

      {/* Transcript / Controls Column */}
      <div className="flex w-full flex-col gap-4 lg:w-80">
        <div className="flex-1 overflow-hidden rounded-2xl border border-border bg-card shadow-xl">
          <div className="border-b border-border p-3">
            <h3 className="text-sm font-medium text-muted-foreground">
              Transcript
            </h3>
          </div>
          <div className="h-96 overflow-y-auto p-4">
            <AgentChatTranscript />
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-xl">
          <AgentControlBar onDisconnect={handleDisconnect} />
        </div>
      </div>
    </div>
  );
}
```

### 5.17 `frontend/src/components/app/AvatarTile.tsx`

The avatar video track is published by Tavus as a standard LiveKit video track. We render it using LiveKit's `VideoTrack` component.

```tsx
import { VideoTrack, useRemoteParticipants } from "@livekit/components-react";
import { Track } from "livekit-client";

export function AvatarTile() {
  const remoteParticipants = useRemoteParticipants();

  // Tavus avatar joins as a participant with identity containing "avatar" or
  // matching the avatar_participant_name configured in the agent.
  // Default Tavus participant name is "Tavus-avatar-agent".
  const avatarParticipant = remoteParticipants.find(
    (p) =>
      p.identity.toLowerCase().includes("avatar") ||
      p.identity.toLowerCase().includes("tavus")
  );

  const videoTrack = avatarParticipant?.getTrackPublication(
    Track.Source.Camera
  );

  if (!videoTrack?.track) {
    return (
      <div className="flex aspect-video items-center justify-center bg-neutral-900">
        <div className="text-center">
          <div className="mx-auto mb-3 h-12 w-12 animate-pulse rounded-full bg-gezellig-500/20" />
          <p className="text-sm text-muted-foreground">
            Connecting to your tutor...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="aspect-video overflow-hidden bg-neutral-900">
      <VideoTrack
        trackRef={{
          participant: avatarParticipant,
          publication: videoTrack,
          source: Track.Source.Camera,
        }}
        className="h-full w-full object-cover"
      />
    </div>
  );
}
```

### 5.18 `frontend/src/hooks/useGezelligSession.ts`

Optional hook for managing session state and exposing it to child components.

```typescript
import { useCallback, useState } from "react";

export type SessionState = "idle" | "connecting" | "active" | "error";

export function useGezelligSession() {
  const [state, setState] = useState<SessionState>("idle");
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async (connectFn: () => Promise<void>) => {
    setState("connecting");
    setError(null);
    try {
      await connectFn();
      setState("active");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
      setState("error");
    }
  }, []);

  const disconnect = useCallback(() => {
    setState("idle");
    setError(null);
  }, []);

  return { state, error, connect, disconnect };
}
```

---

## 6. Token Server (Cloudflare Pages Function)

### 6.1 `frontend/functions/api/token.ts`

This runs on Cloudflare's edge as a Pages Function. It generates a LiveKit room token when a student initiates a session.

**Important:** LiveKit's server SDK (`livekit-server-sdk`) uses Node.js crypto APIs. In Cloudflare Workers/Pages Functions, we use the `jose` library for JWT generation instead, which is Web Crypto API compatible.

```typescript
import * as jose from "jose";

interface Env {
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
}

interface TokenRequest {
  agent_name?: string;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = context.env;

  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    return new Response(
      JSON.stringify({ error: "Server misconfigured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let agentName = "gezellig";
  try {
    const body: TokenRequest = await context.request.json();
    if (body.agent_name) {
      agentName = body.agent_name;
    }
  } catch {
    // Use defaults
  }

  // Generate unique room name and participant identity
  const roomName = `gezellig-${crypto.randomUUID().slice(0, 8)}`;
  const participantIdentity = `student-${crypto.randomUUID().slice(0, 8)}`;
  const participantName = "Student";

  // Build LiveKit JWT
  const secret = new TextEncoder().encode(LIVEKIT_API_SECRET);
  const now = Math.floor(Date.now() / 1000);

  const token = await new jose.SignJWT({
    sub: participantIdentity,
    name: participantName,
    video: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
    metadata: "",
    attributes: {},
    roomConfig: {
      agents: [
        {
          agentName: agentName,
        },
      ],
    },
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(LIVEKIT_API_KEY)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600) // 1 hour
    .setNotBefore(now)
    .setJti(crypto.randomUUID())
    .sign(secret);

  return new Response(
    JSON.stringify({
      token,
      room_name: roomName,
      identity: participantIdentity,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    }
  );
};
```

**Note on the JWT structure:** LiveKit tokens use a specific grant structure under the `video` claim. The `roomConfig.agents` array tells LiveKit Cloud to dispatch the named agent to this room. Verify the exact claim structure against the LiveKit token documentation — the format may have evolved. If the `jose`-based approach has issues, an alternative is to use LiveKit's official `@livekit/server-sdk-js` package with the Node.js compatibility flag in `wrangler.toml`:

```toml
compatibility_flags = ["nodejs_compat"]
```

### 6.2 `frontend/wrangler.toml`

```toml
name = "gezellig"
compatibility_date = "2025-04-01"
compatibility_flags = ["nodejs_compat"]
pages_build_output_dir = "dist"

# Environment variables — set via Wrangler CLI, NOT in this file:
#   wrangler pages secret put LIVEKIT_API_KEY
#   wrangler pages secret put LIVEKIT_API_SECRET
```

---

## 7. Environment Variables Summary

### 7.1 Frontend (Cloudflare Pages)

Set via Wrangler CLI or Cloudflare dashboard:

| Variable | Where | How to Set |
|----------|-------|------------|
| `VITE_LIVEKIT_URL` | Build-time env var | Cloudflare Pages → Settings → Environment Variables |
| `LIVEKIT_API_KEY` | Pages Function secret | `wrangler pages secret put LIVEKIT_API_KEY` |
| `LIVEKIT_API_SECRET` | Pages Function secret | `wrangler pages secret put LIVEKIT_API_SECRET` |

### 7.2 Agent (LiveKit Agent Cloud)

Set via LiveKit CLI:

| Variable | How to Set |
|----------|------------|
| `LIVEKIT_URL` | Automatic (set by Agent Cloud) |
| `LIVEKIT_API_KEY` | Automatic (set by Agent Cloud) |
| `LIVEKIT_API_SECRET` | Automatic (set by Agent Cloud) |
| `INCEPTION_API_KEY` | `lk cloud secret set INCEPTION_API_KEY <value>` |
| `TAVUS_API_KEY` | `lk cloud secret set TAVUS_API_KEY <value>` |
| `TAVUS_REPLICA_ID` | `lk cloud secret set TAVUS_REPLICA_ID <value>` |
| `TAVUS_PERSONA_ID` | `lk cloud secret set TAVUS_PERSONA_ID <value>` |

---

## 8. Deployment Sequence

Execute these steps in order.

### Step 1: Set up Tavus Persona

```bash
# Export your Tavus credentials
export TAVUS_API_KEY="your-tavus-api-key"
export TAVUS_REPLICA_ID="your-replica-id"

# Create persona with LiveKit transport
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
    "default_replica_id": "'$TAVUS_REPLICA_ID'"
  }'

# Save the returned persona_id
export TAVUS_PERSONA_ID="returned-persona-id"
```

### Step 2: Deploy the Agent to LiveKit Agent Cloud

```bash
cd agent/

# Copy env template and fill in values
cp .env.example .env
# Edit .env with your actual credentials

# Install the LiveKit CLI if not already installed
# See: https://docs.livekit.io/home/cli/

# Set secrets in LiveKit Cloud
lk cloud secret set INCEPTION_API_KEY "$INCEPTION_API_KEY"
lk cloud secret set TAVUS_API_KEY "$TAVUS_API_KEY"
lk cloud secret set TAVUS_REPLICA_ID "$TAVUS_REPLICA_ID"
lk cloud secret set TAVUS_PERSONA_ID "$TAVUS_PERSONA_ID"

# Deploy the agent
lk cloud deploy
```

**Validate:** After deployment, the agent should appear in your LiveKit Cloud dashboard under Agents. Its status should show as running and ready to accept sessions.

### Step 3: Test with LiveKit Agents Playground

Before deploying the frontend, test the agent using LiveKit's hosted playground:

1. Go to https://cloud.livekit.io → your project → Playground
2. Select your `gezellig` agent
3. Connect and verify:
   - Audio: Can you hear the Dutch greeting?
   - Avatar: Do you see the Tavus video feed?
   - STT: Does the transcript show your speech?
   - LLM: Does the tutor respond appropriately in Dutch?
   - TTS: Is the Dutch pronunciation natural?

### Step 4: Set up the Frontend

```bash
cd frontend/

# Install dependencies
npm install

# Install Agents UI components via shadcn
npx shadcn@latest add @agents-ui/agent-session-provider
npx shadcn@latest add @agents-ui/agent-control-bar
npx shadcn@latest add @agents-ui/agent-chat-transcript
npx shadcn@latest add @agents-ui/agent-audio-visualizer-bar

# Install jose for token generation in Pages Functions
npm install jose

# Install base shadcn components
npx shadcn@latest add button card

# Create .env for local development
echo "VITE_LIVEKIT_URL=wss://gezellig-XXXXXXXX.livekit.cloud" > .env.local
```

### Step 5: Local Frontend Testing

```bash
cd frontend/

# Start Vite dev server
npm run dev
# Open http://localhost:5173

# For the token endpoint to work locally, you'll need to run
# Cloudflare's local dev environment:
npx wrangler pages dev dist --binding LIVEKIT_API_KEY=your-key LIVEKIT_API_SECRET=your-secret
```

Alternatively, during development you can temporarily hardcode a token or use LiveKit's sandbox token server.

### Step 6: Deploy Frontend to Cloudflare Pages

```bash
cd frontend/

# Build the production bundle
npm run build

# Set secrets for the Pages Function
wrangler pages secret put LIVEKIT_API_KEY
wrangler pages secret put LIVEKIT_API_SECRET

# Set build-time environment variables in Cloudflare dashboard:
# VITE_LIVEKIT_URL = wss://gezellig-XXXXXXXX.livekit.cloud

# Deploy
wrangler pages deploy dist

# Or connect via Git for automatic deployments:
# Cloudflare Dashboard → Pages → Create Project → Connect to Git repo
```

### Step 7: Configure Custom Domain

1. Cloudflare Dashboard → Pages → gezellig project → Custom Domains
2. Add `gezellig.yourdomain.com`
3. DNS record is auto-configured since the domain is on Cloudflare

### Step 8: End-to-End Validation

Open `https://gezellig.yourdomain.com` and verify:

1. **Welcome screen** loads with Gezellig branding
2. Click "Start Gesprek" — connection initiates
3. **Avatar appears** — Tavus video feed renders in the main tile
4. **Greeting plays** — you hear and see the avatar say the Dutch greeting
5. **Speak Dutch (or English)** — the tutor responds, corrects, adapts
6. **Transcript** updates in real-time on the side panel
7. **Disconnect** cleanly returns to welcome screen

---

## 9. Configuration Reference

### 9.1 Cartesia Dutch Voice Selection

Browse available voices at https://play.cartesia.ai/. For Dutch:

- Look for voices with `nl` or `Dutch` language tags
- Cartesia's multilingual voices (e.g., Sonic Multilingual) support Dutch
- If no native Dutch voice is available, use a multilingual voice and test pronunciation quality

In the agent, specify the voice:

```python
from livekit.agents import inference

tts = inference.TTS(
    model="cartesia/sonic",
    voice="<voice-id>",  # From Cartesia voice library
    language="nl",
)
```

### 9.2 Deepgram Dutch STT Configuration

Deepgram Nova-3 supports Dutch (`nl`). In the agent:

```python
from livekit.agents import inference

stt = inference.STT(
    model="deepgram/nova-3",
    language="nl",
)
```

If students mix Dutch and English frequently (common for beginners), consider using `language="multi"` for multilingual transcription, though this may reduce accuracy for Dutch-specific phonemes.

### 9.3 Mercury2 Tuning

Mercury2 exposes several parameters relevant to voice conversation:

| Parameter | Recommended | Notes |
|-----------|-------------|-------|
| `temperature` | 0.7 | Warm, varied but coherent responses |
| `max_tokens` | 150 | Keep responses short for voice |
| `reasoning_effort` | `"instant"` | Minimize latency for real-time conversation |
| `stream` | `true` | Handled automatically by LiveKit OpenAI plugin |

### 9.4 Tavus Avatar Customization

- **Replica**: Choose or create a replica that visually fits the tutor persona. Tavus offers stock replicas or you can create a custom one from video.
- **Persona**: The persona we created in Step 1 has an empty `system_prompt` because all LLM prompting is handled by the agent — Tavus only handles video synthesis from audio.
- **Interruption handling**: Built-in. When the student interrupts, Tavus discards buffered frames and transitions to a listening state.

---

## 10. `.gitignore`

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

---

## 11. Future Enhancements

These are not in scope for the initial build but are natural next steps:

1. **Session memory** — Store conversation context in Cloudflare D1 or KV so returning students can continue where they left off
2. **Vocabulary tracker** — Use a Cloudflare Worker + D1 to track words introduced per session, build a personal vocabulary list
3. **Pronunciation scoring** — Add a post-STT analysis step that scores Dutch pronunciation on specific phonemes (G, UI, SCH, vowel length)
4. **Level assessment** — Opening conversation automatically assesses CEFR level (A1-C2) and adjusts system prompt parameters
5. **Multiple tutors** — Different personas (Amsterdam vs. Flemish dialect, formal vs. casual) with different Tavus replicas
6. **Mobile app** — LiveKit has React Native, Swift, and Flutter starters that can share the same agent backend
