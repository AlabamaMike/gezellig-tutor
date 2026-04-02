import { VideoTrack, useRemoteParticipants } from "@livekit/components-react";
import { Track } from "livekit-client";

export function AvatarTile() {
  const remoteParticipants = useRemoteParticipants();

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
