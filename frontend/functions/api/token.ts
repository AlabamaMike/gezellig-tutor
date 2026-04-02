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

  const roomName = `gezellig-${crypto.randomUUID().slice(0, 8)}`;
  const participantIdentity = `student-${crypto.randomUUID().slice(0, 8)}`;
  const participantName = "Student";

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
    .setExpirationTime(now + 3600)
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
