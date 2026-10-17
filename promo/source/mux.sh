#!/bin/zsh
# Mux video.mp4 + audio.wav into a full-quality master and a web copy for the homepage.
set -e
HERE=${0:A:h}
MASTER=$1   # e.g. promo/haushaltsbuch-promo.mp4
WEB=$2      # e.g. public/home/demo.mp4
AF="loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000"

ffmpeg -y -loglevel error -i "$HERE/video.mp4" -i "$HERE/audio.wav" -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high \
  -af "$AF" -c:a aac -b:a 192k -movflags +faststart -shortest "$MASTER"

ffmpeg -y -loglevel error -i "$HERE/video.mp4" -i "$HERE/audio.wav" -map 0:v -map 1:a \
  -vf "scale=1440:900:flags=lanczos" -c:v libx264 -preset slow -crf 23 -pix_fmt yuv420p -profile:v high \
  -af "$AF" -c:a aac -b:a 128k -movflags +faststart -shortest "$WEB"
ls -la "$MASTER" "$WEB"
