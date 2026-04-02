import { useState, useMemo } from "react";
import { TokenSource } from "livekit-client";
import { useSession } from "@livekit/components-react";
import { AgentSessionProvider } from "@/components/agents-ui/agent-session-provider";
import { GezelligLayout } from "@/components/app/GezelligLayout";
import { WelcomeView } from "@/components/app/WelcomeView";
import { SessionView } from "@/components/app/SessionView";

const LIVEKIT_URL = import.meta.env.VITE_LIVEKIT_URL;
const AGENT_NAME = "gezellig";

function App() {
  const [isConnected, setIsConnected] = useState(false);

  const tokenSource = useMemo(
    () =>
      TokenSource.literal(async () => {
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
          serverUrl: LIVEKIT_URL,
          participantToken: data.token,
        };
      }),
    []
  );

  const session = useSession(tokenSource);

  return (
    <AgentSessionProvider session={session}>
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
