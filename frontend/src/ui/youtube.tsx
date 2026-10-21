import { useEffect, useRef } from "react";

interface YtPlayer {
  mute: () => void;
  playVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  destroy: () => void;
}

interface YtEvent {
  target: YtPlayer;
  data?: number;
}

interface YtNamespace {
  Player: new (element: HTMLElement, options: Record<string, unknown>) => YtPlayer;
  PlayerState: { ENDED: number };
}

declare global {
  interface Window {
    YT?: YtNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let youtubeReady: Promise<YtNamespace> | null = null;

function loadYouTubeApi(): Promise<YtNamespace> {
  if (youtubeReady) return youtubeReady;
  youtubeReady = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    window.onYouTubeIframeAPIReady = () => {
      if (window.YT) resolve(window.YT);
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(script);
  });
  return youtubeReady;
}

export interface LoopPlayer {
  destroy: () => void;
}

export async function createLoopPlayer(container: HTMLElement, videoId: string, start: number | null, end: number | null): Promise<LoopPlayer> {
  container.replaceChildren(document.createElement("div"));
  const shield = document.createElement("div");
  shield.className = "shield";
  container.appendChild(shield);
  const target = container.firstElementChild as HTMLElement;
  const YT = await loadYouTubeApi();
  const startAt = start ?? 0;
  const playerVars: Record<string, string | number> = {
    autoplay: 1, mute: 1, controls: 0, loop: 1, playlist: videoId, rel: 0, playsinline: 1, modestbranding: 1, iv_load_policy: 3, disablekb: 1, fs: 0,
  };
  if (startAt) playerVars.start = startAt;
  if (end) playerVars.end = end;
  let poll = 0;
  const player = new YT.Player(target, {
    videoId,
    host: "https://www.youtube-nocookie.com",
    playerVars,
    events: {
      onReady: (event: YtEvent) => {
        event.target.mute();
        event.target.playVideo();
        poll = window.setInterval(() => {
          try {
            const current = event.target.getCurrentTime();
            if (end && current >= end) event.target.seekTo(startAt, true);
            if (startAt && current < startAt - 1) event.target.seekTo(startAt, true);
          } catch {
            window.clearInterval(poll);
          }
        }, 300);
      },
      onStateChange: (event: YtEvent) => {
        if (event.data === YT.PlayerState.ENDED) {
          event.target.seekTo(startAt, true);
          event.target.playVideo();
        }
      },
    },
  });
  return {
    destroy() {
      window.clearInterval(poll);
      try {
        player.destroy();
      } catch {
        return;
      }
    },
  };
}

interface LoopVideoProps {
  videoId: string;
  start?: number | null;
  end?: number | null;
  className?: string;
  id?: string;
}

export function LoopVideo({ videoId, start = null, end = null, className = "media-frame", id }: LoopVideoProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let cancelled = false;
    let player: LoopPlayer | null = null;
    void createLoopPlayer(element, videoId, start, end).then((created) => {
      if (cancelled) created.destroy();
      else player = created;
    });
    return () => {
      cancelled = true;
      player?.destroy();
      element.replaceChildren();
    };
  }, [videoId, start, end]);
  return <div ref={ref} className={className} id={id} />;
}
