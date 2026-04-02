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
