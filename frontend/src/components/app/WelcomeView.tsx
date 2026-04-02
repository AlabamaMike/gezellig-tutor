import { useSessionContext } from "@livekit/components-react";

interface WelcomeViewProps {
  onConnect: () => void;
}

export function WelcomeView({ onConnect }: WelcomeViewProps) {
  const session = useSessionContext();

  const handleStart = async () => {
    try {
      await session.start();
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
