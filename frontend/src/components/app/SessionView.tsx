import { useSessionContext } from "@livekit/components-react";
import { AgentControlBar } from "@/components/agents-ui/agent-control-bar";
import { AgentChatTranscript } from "@/components/agents-ui/agent-chat-transcript";
import { AgentAudioVisualizerBar } from "@/components/agents-ui/agent-audio-visualizer-bar";
import { AvatarTile } from "./AvatarTile";

interface SessionViewProps {
  onDisconnect: () => void;
}

export function SessionView({ onDisconnect }: SessionViewProps) {
  const session = useSessionContext();

  const handleDisconnect = async () => {
    await session.end();
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
