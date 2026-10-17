"use client";

import { useEffect, useRef, useState } from "react";

/** Drop the demo clip at public/home/demo.mp4; until then the frame shows a placeholder. */
export const HOME_VIDEO_SRC = "/home/demo.mp4";

export function HomeVideo() {
  const [missing, setMissing] = useState(false);
  const [muted, setMuted] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Autoplay only works muted. Turning sound on restarts the clip so the music lines up from the top.
  function toggleSound() {
    const video = videoRef.current;
    if (!video) return;
    const next = !muted;
    video.muted = next;
    if (!next) {
      video.currentTime = 0;
      void video.play();
    }
    setMuted(next);
  }

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
        <>
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
          <button
            type="button"
            className="home-video-sound"
            onClick={toggleSound}
            aria-pressed={!muted}
            aria-label={muted ? "Turn sound on" : "Turn sound off"}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
              {muted ? (
                <path d="M16 9.5l5 5M21 9.5l-5 5" />
              ) : (
                <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11" />
              )}
            </svg>
            <span>{muted ? "Sound on" : "Sound off"}</span>
          </button>
        </>
      )}
    </div>
  );
}
