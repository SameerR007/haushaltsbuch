"use client";

import { useEffect, useRef, useState } from "react";

/** Drop the demo clip at public/home/demo.mp4; until then the frame shows a placeholder. */
export const HOME_VIDEO_SRC = "/home/demo.mp4";

export function HomeVideo() {
  const [missing, setMissing] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  // A missing file can fail before hydration attaches onError, so check once on mount too.
  useEffect(() => {
    const video = videoRef.current;
    if (video && (video.error || video.networkState === video.NETWORK_NO_SOURCE)) setMissing(true);
  }, []);

  return (
    <div className="home-video">
      <div className="home-video-bar" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      {missing ? (
        <div className="home-video-placeholder">
          <span className="home-video-play" aria-hidden="true" />
          <p>Demo video coming soon</p>
        </div>
      ) : (
        <video
          ref={videoRef}
          src={HOME_VIDEO_SRC}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="Haushaltsbuch demo"
          onError={() => setMissing(true)}
        />
      )}
    </div>
  );
}
