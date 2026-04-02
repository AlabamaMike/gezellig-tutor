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
