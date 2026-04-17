import { AccessToken } from "livekit-server-sdk";

// ─── Generate tokens for candidates and agents ─────────────────────────────

export function generateCandidateToken(
  roomName: string,
  candidateName: string
): string {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: `candidate-${Date.now()}`,
      name: candidateName,
      ttl: "2h",
    }
  );

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return at.toJwt() as unknown as string;
}

export function generateAgentToken(roomName: string): string {
  const at = new AccessToken(
    process.env.LIVEKIT_API_KEY,
    process.env.LIVEKIT_API_SECRET,
    {
      identity: `accionhire-agent`,
      name: "AccionHire AI",
      ttl: "2h",
    }
  );

  at.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    agent: true,
  });

  return at.toJwt() as unknown as string;
}

export function generateRoomName(interviewId: number): string {
  return `accionhire-interview-${interviewId}-${Date.now()}`;
}