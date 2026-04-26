import { useEffect, useRef, useState, useCallback } from "react";
import { ChevronRight, Battery, BatteryCharging, Music, Upload, Plug } from "lucide-react";

export type Song = {
  id: string;
  title: string;
  artist: string;
  album: string;
  url: string;
  duration: number;
  cover?: string;
  source: "local" | "spotify";
  previewOnly?: boolean;
  uri?: string;
};

type Screen =
  | { kind: "menu" }
  | { kind: "music" }
  | { kind: "songs" }
  | { kind: "artists" }
  | { kind: "albums" }
  | { kind: "artistSongs"; artist: string }
  | { kind: "albumSongs"; album: string }
  | { kind: "nowPlaying" }
  | { kind: "settings" }
  | { kind: "sources" }
  | { kind: "about" }
  | { kind: "empty"; message: string };

type MenuItem = { label: string; icon?: React.ReactNode; action: () => void; hint?: string };

function fmt(s: number) {
  if (!isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

type Props = {
  songs: Song[];
  onImportFiles: () => void;
  onConnectSpotify: () => void;
  spotifyConnected: boolean;
  spotifyAccessToken?: string | null;
  onSpotifyPlaybackError?: (message: string | null) => void;
};

const SPOTIFY_SDK_URL = "https://sdk.scdn.co/spotify-player.js";

const loadSpotifyPlaybackSdk = () => {
  return new Promise<void>((resolve, reject) => {
    const win = window as any;
    if (win.Spotify?.Player) {
      resolve();
      return;
    }

    win.onSpotifyWebPlaybackSDKReady = () => resolve();

    const existingScript = document.querySelector<HTMLScriptElement>(`script[src="${SPOTIFY_SDK_URL}"]`);
    if (existingScript) {
      existingScript.addEventListener("load", () => resolve(), { once: true });
      existingScript.addEventListener("error", () => reject(new Error("Failed to load Spotify Web Playback SDK.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = SPOTIFY_SDK_URL;
    script.async = true;
    script.onerror = () => reject(new Error("Failed to load Spotify Web Playback SDK."));
    document.body.appendChild(script);
  });
};

export function IPod({
  songs,
  onImportFiles,
  onConnectSpotify,
  spotifyConnected,
  spotifyAccessToken,
  onSpotifyPlaybackError,
}: Props) {
  const [stack, setStack] = useState<Screen[]>([{ kind: "menu" }]);
  const [selected, setSelected] = useState<number[]>([0]);
  const [title, setTitle] = useState<string[]>(["iPod"]);

  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(0.8);
  const [spotifyDeviceId, setSpotifyDeviceId] = useState<string | null>(null);

  // Real device battery
  const [battery, setBattery] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);
  const [time, setTime] = useState(() => new Date());

  // Animation flags
  const [ripple, setRipple] = useState(0);
  const [pressed, setPressed] = useState<string | null>(null);
  const [wheelSpin, setWheelSpin] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const spotifyPlayerRef = useRef<any>(null);
  const screen = stack[stack.length - 1];
  const sel = selected[selected.length - 1];
  const currentSong = songs[currentIdx];
  const currentSongUsesSpotify = Boolean(currentSong?.source === "spotify" && currentSong.uri && spotifyAccessToken);
  const currentSongUrl = currentSongUsesSpotify ? "" : currentSong?.url ?? "";

  useEffect(() => {
    const i = setInterval(() => setTime(new Date()), 30000);
    return () => clearInterval(i);
  }, []);

  useEffect(() => {
    const nav = navigator as unknown as { getBattery?: () => Promise<BatteryManager> };
    if (!nav.getBattery) return;
    let bat: BatteryManager | null = null;
    const update = () => {
      if (!bat) return;
      setBattery(Math.round(bat.level * 100));
      setCharging(bat.charging);
    };
    nav.getBattery().then((b) => {
      bat = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    }).catch(() => {});
    return () => {
      if (!bat) return;
      bat.removeEventListener("levelchange", update);
      bat.removeEventListener("chargingchange", update);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    spotifyPlayerRef.current?.setVolume?.(volume);
  }, [volume]);

  useEffect(() => {
    if (!spotifyAccessToken) return;

    let cancelled = false;

    const setupSpotifyPlayer = async () => {
      try {
        await loadSpotifyPlaybackSdk();
        if (cancelled || spotifyPlayerRef.current) return;

        const win = window as any;
        const player = new win.Spotify.Player({
          name: "Interactive iPod",
          getOAuthToken: (cb: (token: string) => void) => cb(spotifyAccessToken),
          volume,
        });

        spotifyPlayerRef.current = player;

        player.addListener("ready", ({ device_id }: { device_id: string }) => {
          setSpotifyDeviceId(device_id);
          onSpotifyPlaybackError?.(null);
        });
        player.addListener("not_ready", () => setSpotifyDeviceId(null));
        player.addListener("initialization_error", ({ message }: { message: string }) => {
          onSpotifyPlaybackError?.(`Spotify player failed to initialize: ${message}`);
        });
        player.addListener("authentication_error", ({ message }: { message: string }) => {
          onSpotifyPlaybackError?.(`Spotify authentication expired. Reconnect Spotify. ${message}`);
        });
        player.addListener("account_error", ({ message }: { message: string }) => {
          onSpotifyPlaybackError?.(`Spotify Premium is required to play full tracks here. ${message}`);
        });
        player.addListener("playback_error", ({ message }: { message: string }) => {
          onSpotifyPlaybackError?.(`Spotify playback failed: ${message}`);
        });
        player.addListener("player_state_changed", (state: any) => {
          if (!state) return;
          setIsPlaying(!state.paused);
          setProgress((state.position || 0) / 1000);
          setDuration((state.duration || 0) / 1000);
        });

        const connected = await player.connect();
        if (!connected) onSpotifyPlaybackError?.("Spotify player could not connect in this browser.");
      } catch (error: any) {
        onSpotifyPlaybackError?.(error.message || "Failed to load Spotify player.");
      }
    };

    setupSpotifyPlayer();

    return () => {
      cancelled = true;
      spotifyPlayerRef.current?.disconnect?.();
      spotifyPlayerRef.current = null;
    };
  }, [spotifyAccessToken]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    setProgress(0);
    setDuration(0);

    if (!currentSongUrl) {
      if (!currentSongUsesSpotify) setIsPlaying(false);
      a.pause();
      a.removeAttribute("src");
      a.load();
      return;
    }

    a.src = currentSongUrl;
    a.load();
  }, [currentIdx, currentSongUrl]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    if (!isPlaying || !currentSongUrl) {
      a.pause();
      return;
    }
    a.play().catch(() => setIsPlaying(false));
  }, [isPlaying, currentSongUrl]);

  useEffect(() => {
    if (!currentSongUsesSpotify || !spotifyPlayerRef.current) return;
    if (isPlaying) {
      spotifyPlayerRef.current.resume?.().catch(() => {});
    } else {
      spotifyPlayerRef.current.pause?.().catch(() => {});
    }
  }, [isPlaying, currentSongUsesSpotify]);

  const pushScreen = (s: Screen, t: string) => {
    setStack((p) => [...p, s]);
    setSelected((p) => [...p, 0]);
    setTitle((p) => [...p, t]);
  };

  const popScreen = () => {
    if (stack.length <= 1) return;
    setStack((p) => p.slice(0, -1));
    setSelected((p) => p.slice(0, -1));
    setTitle((p) => p.slice(0, -1));
  };

  const setSel = (n: number) => {
    setSelected((p) => {
      const c = [...p];
      c[c.length - 1] = n;
      return c;
    });
  };

  const isSongPlayable = (song?: Song) => {
    if (!song) return false;
    if (song.source === "spotify") return Boolean(song.uri && spotifyAccessToken);
    return Boolean(song.url);
  };

  const findPlayableSongIndex = (fromIdx: number, direction: 1 | -1) => {
    if (songs.length < 2) return -1;

    for (let step = 1; step < songs.length; step += 1) {
      const idx = (fromIdx + step * direction + songs.length) % songs.length;
      if (isSongPlayable(songs[idx])) return idx;
    }

    return -1;
  };

  const startSpotifyTrack = async (song: Song) => {
    if (!song.uri) {
      onSpotifyPlaybackError?.("Spotify did not provide a track URI for this song.");
      setIsPlaying(false);
      return;
    }

    if (!spotifyAccessToken) {
      onSpotifyPlaybackError?.("Reconnect Spotify to play full tracks.");
      setIsPlaying(false);
      return;
    }

    if (!spotifyDeviceId || !spotifyPlayerRef.current) {
      onSpotifyPlaybackError?.("Spotify player is still connecting. Try again in a moment.");
      setIsPlaying(false);
      return;
    }

    try {
      await spotifyPlayerRef.current.activateElement?.();

      const headers = {
        Authorization: `Bearer ${spotifyAccessToken}`,
        "Content-Type": "application/json",
      };

      const transferRes = await fetch("https://api.spotify.com/v1/me/player", {
        method: "PUT",
        headers,
        body: JSON.stringify({ device_ids: [spotifyDeviceId], play: false }),
      });

      if (!transferRes.ok) {
        if (transferRes.status === 403) {
          throw new Error("Spotify Premium is required to play full tracks here.");
        }
        throw new Error(`Spotify player transfer failed with status ${transferRes.status}.`);
      }

      const playRes = await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${spotifyDeviceId}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ uris: [song.uri], position_ms: 0 }),
      });

      if (!playRes.ok) {
        if (playRes.status === 403) {
          throw new Error("Spotify Premium is required to play full tracks here.");
        }
        throw new Error(`Spotify playback failed with status ${playRes.status}.`);
      }

      onSpotifyPlaybackError?.(null);
      setIsPlaying(true);
    } catch (error: any) {
      onSpotifyPlaybackError?.(error.message || "Spotify playback failed.");
      setIsPlaying(false);
    }
  };

  const playAdjacentSong = (direction: 1 | -1, stopWhenMissing = false) => {
    const nextIdx = findPlayableSongIndex(currentIdx, direction);
    if (nextIdx === -1) {
      if (stopWhenMissing) setIsPlaying(false);
      return;
    }

    playSongAt(nextIdx, false);
  };

  const playSongAt = (idx: number, openNowPlaying = true) => {
    if (!songs[idx]) return;
    const song = songs[idx];
    setCurrentIdx(idx);
    if (openNowPlaying && screen.kind !== "nowPlaying") pushScreen({ kind: "nowPlaying" }, "Now Playing");

    if (song.source === "spotify") {
      setProgress(0);
      setDuration(song.duration);
      setIsPlaying(false);
      startSpotifyTrack(song);
      return;
    }

    setIsPlaying(Boolean(song.url));
  };

  const playRandomSong = () => {
    const playableIndexes = songs
      .map((song, idx) => (isSongPlayable(song) ? idx : -1))
      .filter((idx) => idx !== -1);

    if (!playableIndexes.length) {
      pushScreen(
        {
          kind: "empty",
          message: "Spotify did not provide playable previews for these tracks. Import local audio files to play them here.",
        },
        "No Preview"
      );
      return;
    }

    playSongAt(playableIndexes[Math.floor(Math.random() * playableIndexes.length)]);
  };

  const getSongHint = (song: Song) => {
    if (song.source !== "spotify") return undefined;
    if (song.uri && spotifyAccessToken) return "Spotify";
    return song.url ? "30s" : "Reconnect";
  };

  const songMenuItem = (song: Song, idx: number): MenuItem => ({
    label: song.title,
    hint: getSongHint(song),
    action: () => playSongAt(idx),
  });

  const requireSongs = (action: () => void) => {
    if (!songs.length) {
      pushScreen(
        {
          kind: "empty",
          message: "No Music. Go to Sources to import files or connect Spotify.",
        },
        "Music"
      );
      return;
    }
    action();
  };

  const getItems = useCallback((): MenuItem[] => {
    switch (screen.kind) {
      case "menu":
        return [
          { label: "Music", icon: <Music size={10} />, action: () => pushScreen({ kind: "music" }, "Music") },
          { label: "Sources", icon: <Plug size={10} />, action: () => pushScreen({ kind: "sources" }, "Sources") },
          { label: "Shuffle Songs", action: () => requireSongs(playRandomSong) },
          { label: "Now Playing", action: () => songs[currentIdx] && pushScreen({ kind: "nowPlaying" }, "Now Playing") },
          { label: "Settings", action: () => pushScreen({ kind: "settings" }, "Settings") },
        ];
      case "sources":
        return [
          {
            label: "Import Files…",
            icon: <Upload size={10} />,
            action: onImportFiles,
            hint: "Audio from device",
          },
          {
            label: spotifyConnected ? "Spotify: Connected ✓" : "Connect to Spotify…",
            icon: <Plug size={10} />,
            action: onConnectSpotify,
            hint: "Saved tracks (30s)",
          },
        ];
      case "music":
        return [
          { label: "Playlists", action: () => requireSongs(() => pushScreen({ kind: "songs" }, "All Songs")) },
          { label: "Artists", action: () => requireSongs(() => pushScreen({ kind: "artists" }, "Artists")) },
          { label: "Albums", action: () => requireSongs(() => pushScreen({ kind: "albums" }, "Albums")) },
          { label: "Songs", action: () => requireSongs(() => pushScreen({ kind: "songs" }, "Songs")) },
        ];
      case "songs":
        return songs.map((s, i) => songMenuItem(s, i));
      case "artists": {
        const artists = Array.from(new Set(songs.map((s) => s.artist)));
        return artists.map((a) => ({
          label: a,
          action: () => pushScreen({ kind: "artistSongs", artist: a }, a),
        }));
      }
      case "albums": {
        const albums = Array.from(new Set(songs.map((s) => s.album)));
        return albums.map((a) => ({
          label: a,
          action: () => pushScreen({ kind: "albumSongs", album: a }, a),
        }));
      }
      case "artistSongs":
        return songs
          .filter((s) => s.artist === screen.artist)
          .map((s) => songMenuItem(s, songs.indexOf(s)));
      case "albumSongs":
        return songs
          .filter((s) => s.album === screen.album)
          .map((s) => songMenuItem(s, songs.indexOf(s)));
      case "settings":
        return [
          { label: "About", action: () => pushScreen({ kind: "about" }, "About") },
          { label: "Shuffle", action: () => {} },
          { label: "Repeat", action: () => {} },
          { label: "Backlight", action: () => {} },
        ];
      default:
        return [];
    }
  }, [screen, songs, currentIdx, spotifyConnected]);

  const items = getItems();

  const flashPressed = (k: string) => {
    setPressed(k);
    setTimeout(() => setPressed((p) => (p === k ? null : p)), 140);
  };

  const onCenter = () => {
    flashPressed("center");
    setRipple((r) => r + 1);
    if (screen.kind === "nowPlaying") {
      if (!currentSong) return;
      if (currentSong.source === "spotify") {
        if (isPlaying) setIsPlaying(false);
        else startSpotifyTrack(currentSong);
        return;
      }
      if (!currentSong.url && !isPlaying) return;
      setIsPlaying((p) => !p);
      return;
    }
    const it = items[sel];
    if (it) it.action();
  };

  const onMenu = () => { flashPressed("menu"); popScreen(); };

  const onNext = () => {
    flashPressed("next");
    if (screen.kind === "nowPlaying") {
      if (!songs.length) return;
      playAdjacentSong(1);
    } else if (items.length) {
      setSel(Math.min(items.length - 1, sel + 1));
    }
  };

  const onPrev = () => {
    flashPressed("prev");
    if (screen.kind === "nowPlaying") {
      if (progress > 3 && audioRef.current) {
        audioRef.current.currentTime = 0;
      } else if (songs.length) {
        playAdjacentSong(-1);
      }
    } else if (items.length) {
      setSel(Math.max(0, sel - 1));
    }
  };

  const onPlayPause = () => {
    flashPressed("play");
    const song = songs[currentIdx];
    if (!song) return;
    if (song.source === "spotify") {
      if (isPlaying) setIsPlaying(false);
      else startSpotifyTrack(song);
      return;
    }
    if (!song.url && !isPlaying) return; // Can't play a track with no URL
    setIsPlaying((p) => !p);
  };

  // wheel drag
  const wheelRef = useRef<HTMLDivElement | null>(null);
  const angleRef = useRef<number | null>(null);
  const accumRef = useRef(0);
  const selRef = useRef(sel);
  const itemsLenRef = useRef(items.length);
  const kindRef = useRef(screen.kind);
  selRef.current = sel;
  itemsLenRef.current = items.length;
  kindRef.current = screen.kind;

  const onWheelPointerDown = (e: React.PointerEvent) => {
    const el = wheelRef.current;
    if (!el) return;
    el.setPointerCapture(e.pointerId);
    const r = el.getBoundingClientRect();
    angleRef.current = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };

  const onWheelPointerMove = (e: React.PointerEvent) => {
    if (angleRef.current == null) return;
    const el = wheelRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const a = Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
    let delta = a - angleRef.current;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    angleRef.current = a;
    accumRef.current += delta;
    setWheelSpin((s) => s + delta * 40);
    const step = Math.PI / 10;
    while (accumRef.current > step) {
      accumRef.current -= step;
      if (kindRef.current === "nowPlaying") setVolume((v) => Math.min(1, v + 0.04));
      else if (itemsLenRef.current > 0) {
        const next = Math.min(itemsLenRef.current - 1, selRef.current + 1);
        selRef.current = next;
        setSel(next);
      }
    }
    while (accumRef.current < -step) {
      accumRef.current += step;
      if (kindRef.current === "nowPlaying") setVolume((v) => Math.max(0, v - 0.04));
      else if (itemsLenRef.current > 0) {
        const next = Math.max(0, selRef.current - 1);
        selRef.current = next;
        setSel(next);
      }
    }
  };

  const onWheelPointerUp = (e: React.PointerEvent) => {
    angleRef.current = null;
    accumRef.current = 0;
    try { wheelRef.current?.releasePointerCapture(e.pointerId); } catch {}
  };

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowDown") { e.preventDefault(); onNext(); }
      else if (e.key === "ArrowUp") { e.preventDefault(); onPrev(); }
      else if (e.key === "Enter") { e.preventDefault(); onCenter(); }
      else if (e.key === "Escape" || e.key === "Backspace") { e.preventDefault(); onMenu(); }
      else if (e.key === " ") { e.preventDefault(); onPlayPause(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    if (sel >= items.length && items.length > 0) setSel(items.length - 1);
  }, [items.length]);

  const timeStr = time.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className="flex items-center justify-center">
      <audio
        ref={audioRef}
        onTimeUpdate={(e) => setProgress((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
        onEnded={() => {
          if (!songs.length) return;
          playAdjacentSong(1, true);
        }}
      />

      <div
        className="relative rounded-[40px]"
        style={{
          width: "min(340px, 92vw)",
          aspectRatio: "340 / 560",
          background: "linear-gradient(145deg, #fafafa, #d4d4d4)",
          boxShadow:
            "0 25px 60px -15px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.9) inset, 0 -8px 24px rgba(0,0,0,0.08) inset",
          border: "1px solid rgba(255,255,255,0.6)",
        }}
      >
        {/* Screen bezel */}
        <div
          className="absolute left-1/2 -translate-x-1/2 overflow-hidden"
          style={{
            top: "5%",
            width: "82%",
            height: "45%",
            borderRadius: "6px",
            background: "#c8d4dc",
            boxShadow:
              "inset 0 3px 10px rgba(0,0,0,0.45), 0 0 0 3px #141414, 0 0 0 4px rgba(255,255,255,0.4)",
          }}
        >
          {/* title bar */}
          <div
            className="flex items-center justify-between px-2 text-white"
            style={{
              height: "22px",
              background:
                "linear-gradient(to bottom, #a8c2dd 0%, #5f83ab 45%, #3e6292 55%, #547ba3 100%)",
              borderBottom: "1px solid #2a4266",
              fontSize: "11px",
              textShadow: "0 1px 0 rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ width: 18 }}>
              {isPlaying ? (
                <span style={{ display: "inline-block", animation: "ipod-pulse 1.2s infinite" }}>▶</span>
              ) : screen.kind === "nowPlaying" ? "❚❚" : ""}
            </div>
            <div className="truncate px-1" style={{ fontWeight: 600 }}>
              {title[title.length - 1]}
            </div>
            <div className="flex items-center gap-1" style={{ fontSize: "9px" }}>
              <span>{timeStr}</span>
              <BatteryIcon level={battery} charging={charging} />
            </div>
          </div>

          {/* content with slide animation */}
          <div
            key={stack.length + "-" + screen.kind}
            className="relative w-full"
            style={{
              height: "calc(100% - 22px)",
              background: "linear-gradient(to bottom, #f4f7fa, #dde3ea)",
              animation: "ipod-slide 220ms ease-out",
            }}
          >
            {(screen.kind === "menu" ||
              screen.kind === "music" ||
              screen.kind === "songs" ||
              screen.kind === "artists" ||
              screen.kind === "albums" ||
              screen.kind === "artistSongs" ||
              screen.kind === "albumSongs" ||
              screen.kind === "settings" ||
              screen.kind === "sources") && (
              <MenuList items={items} selected={sel} />
            )}

            {screen.kind === "nowPlaying" && currentSong && (
              <NowPlaying
                song={currentSong}
                idx={currentIdx}
                total={songs.length}
                progress={progress}
                duration={duration || currentSong.duration}
                volume={volume}
                isPlaying={isPlaying}
                spotifyPlaybackAvailable={Boolean(currentSong.source === "spotify" && currentSong.uri && spotifyAccessToken)}
              />
            )}

            {screen.kind === "nowPlaying" && !currentSong && (
              <div className="p-3 text-center" style={{ fontSize: "11px", color: "#444" }}>
                No track loaded.
              </div>
            )}

            {screen.kind === "about" && (
              <div className="p-3" style={{ fontSize: "11px", color: "#222" }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>iPod</div>
                <div>Songs: {songs.length}</div>
                <div>Battery: {battery == null ? "—" : battery + "%"}{charging ? " ⚡" : ""}</div>
                <div>Version: 1.3</div>
                <div>Model: MA002</div>
              </div>
            )}

            {screen.kind === "empty" && (
              <div className="p-3 flex items-center justify-center h-full text-center" style={{ fontSize: "11px", color: "#444" }}>
                {screen.message}
              </div>
            )}
          </div>
        </div>

        {/* Click wheel */}
        <div
          ref={wheelRef}
          onPointerDown={onWheelPointerDown}
          onPointerMove={onWheelPointerMove}
          onPointerUp={onWheelPointerUp}
          onPointerCancel={onWheelPointerUp}
          className="absolute left-1/2 -translate-x-1/2 rounded-full touch-none"
          style={{
            bottom: "4%",
            width: "70%",
            aspectRatio: "1",
            background:
              "radial-gradient(circle at 30% 28%, #ffffff 0%, #eeeeee 40%, #cfcfcf 75%, #b0b0b0 100%)",
            boxShadow:
              "inset 0 2px 3px rgba(255,255,255,0.9), inset 0 -4px 10px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.25)",
          }}
        >
          {/* inner subtle rotation ring for feedback */}
          <div
            className="absolute inset-0 rounded-full pointer-events-none"
            style={{
              background:
                "radial-gradient(circle at 50% 50%, transparent 58%, rgba(0,0,0,0.05) 62%, transparent 64%)",
              opacity: Math.min(0.6, Math.abs(wheelSpin % 360) > 0 ? 0.35 : 0),
              transition: "opacity 200ms ease-out",
            }}
          />
          <WheelLabel
            position="top"
            label="MENU"
            onClick={onMenu}
            pressed={pressed === "menu"}
          />
          <WheelLabel
            position="left"
            label="⏮"
            onClick={onPrev}
            pressed={pressed === "prev"}
          />
          <WheelLabel
            position="right"
            label="⏭"
            onClick={onNext}
            pressed={pressed === "next"}
          />
          <WheelLabel
            position="bottom"
            label={isPlaying ? "⏸" : "▶"}
            onClick={onPlayPause}
            pressed={pressed === "play"}
          />

          {/* Center button */}
          <button
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); onCenter(); }}
            className="absolute rounded-full overflow-hidden"
            style={{
              width: "38%",
              aspectRatio: "1",
              top: "50%",
              left: "50%",
              margin: 0,
              padding: 0,
              background:
                "radial-gradient(circle at 50% 38%, #ffffff 0%, #ececec 55%, #c9c9c9 100%)",
              boxShadow: pressed === "center"
                ? "inset 0 3px 6px rgba(0,0,0,0.3)"
                : "inset 0 1px 2px rgba(255,255,255,0.9), inset 0 -2px 4px rgba(0,0,0,0.2), 0 1px 3px rgba(0,0,0,0.25)",
              transform: pressed === "center"
                ? "translate(-50%, -50%) scale(0.96)"
                : "translate(-50%, -50%) scale(1)",
              transformOrigin: "center center",
              transition: "transform 110ms, box-shadow 110ms",
            }}
          >
            {ripple > 0 && (
              <span
                key={ripple}
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{
                  background:
                    "radial-gradient(circle at 35% 30%, rgba(255,255,255,0.55), rgba(255,255,255,0.15) 45%, transparent 70%)",
                  animation: "ipod-ripple 260ms ease-out forwards",
                  mixBlendMode: "screen",
                }}
              />
            )}
          </button>
        </div>

        <style>{`
          @keyframes ipod-slide {
            from { opacity: 0; transform: translateX(6px); }
            to { opacity: 1; transform: translateX(0); }
          }
          @keyframes ipod-ripple {
            from { transform: scale(0.4); opacity: 0.8; }
            to { transform: scale(1.6); opacity: 0; }
          }
          @keyframes ipod-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
          @keyframes ipod-highlight {
            from { transform: translateX(-4px); opacity: 0.4; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>
      </div>
    </div>
  );
}

function WheelLabel({
  position,
  label,
  onClick,
  pressed,
}: {
  position: "top" | "bottom" | "left" | "right";
  label: string;
  onClick: () => void;
  pressed: boolean;
}) {
  const pos: Record<string, React.CSSProperties> = {
    top: { top: "8%", left: "50%", transform: "translateX(-50%)" },
    bottom: { bottom: "8%", left: "50%", transform: "translateX(-50%)" },
    left: { left: "8%", top: "50%", transform: "translateY(-50%)" },
    right: { right: "8%", top: "50%", transform: "translateY(-50%)" },
  };
  return (
    <button
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="absolute text-[#555]"
      style={{
        ...pos[position],
        fontSize: position === "top" || position === "bottom" ? "11px" : "13px",
        fontWeight: 600,
        letterSpacing: position === "top" ? "1px" : "0",
        opacity: pressed ? 0.5 : 0.9,
        transform: `${pos[position].transform} scale(${pressed ? 0.88 : 1})`,
        transition: "transform 110ms, opacity 110ms",
      }}
    >
      {label}
    </button>
  );
}

function BatteryIcon({ level, charging }: { level: number | null; charging: boolean }) {
  const pct = level ?? 75;
  return (
    <div className="relative flex items-center" title={level != null ? `${pct}%${charging ? " charging" : ""}` : "Battery unavailable"}>
      {charging ? <BatteryCharging size={13} /> : <Battery size={13} />}
      <div
        className="absolute"
        style={{
          left: 2,
          top: 4,
          height: 5,
          width: Math.max(1, (pct / 100) * 7),
          background: pct <= 15 ? "#ff5a5a" : "#fff",
          borderRadius: 1,
        }}
      />
    </div>
  );
}

function MenuList({ items, selected }: { items: MenuItem[]; selected: number }) {
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  if (!items.length) {
    return (
      <div className="p-3 text-center" style={{ fontSize: "11px", color: "#666" }}>
        Empty
      </div>
    );
  }

  return (
    <div ref={listRef} className="h-full overflow-y-auto" style={{ scrollbarWidth: "none" }}>
      {items.map((it, i) => {
        const isSel = i === selected;
        return (
          <div
            key={i}
            data-idx={i}
            className="flex items-center justify-between px-2"
            style={{
              height: "20px",
              fontSize: "12px",
              background: isSel
                ? "linear-gradient(to bottom, #a4ccff 0%, #3d7fd4 55%, #2a5bae 100%)"
                : "transparent",
              color: isSel ? "#fff" : "#1a1a1a",
              textShadow: isSel ? "0 1px 0 rgba(0,0,0,0.35)" : "none",
              borderBottom: "1px solid rgba(0,0,0,0.05)",
              animation: isSel ? "ipod-highlight 140ms ease-out" : undefined,
            }}
          >
            <span className="flex min-w-0 items-center gap-1 truncate">
              {it.icon}
              {it.label}
            </span>
            {it.hint && (
              <span
                className="ml-auto shrink-0 pl-1"
                style={{
                  fontSize: "9px",
                  opacity: isSel ? 0.9 : 0.55,
                }}
              >
                {it.hint}
              </span>
            )}
            <ChevronRight size={12} style={{ opacity: isSel ? 1 : 0.6 }} />
          </div>
        );
      })}
    </div>
  );
}

function NowPlaying({
  song,
  idx,
  total,
  progress,
  duration,
  volume,
  isPlaying,
  spotifyPlaybackAvailable,
}: {
  song: Song;
  idx: number;
  total: number;
  progress: number;
  duration: number;
  volume: number;
  isPlaying: boolean;
  spotifyPlaybackAvailable: boolean;
}) {
  const pct = duration > 0 ? (progress / duration) * 100 : 0;
  return (
    <div className="px-2 pt-1 pb-2 h-full flex flex-col" style={{ fontSize: "10px", color: "#1a1a1a" }}>
      <div className="flex justify-between mb-1" style={{ color: "#555" }}>
        <span>{idx + 1} of {total}</span>
        {spotifyPlaybackAvailable && <span style={{ color: "#1db954" }}>Spotify</span>}
        {!spotifyPlaybackAvailable && song.source === "spotify" && !song.url && (
          <span style={{ color: "#9a6a00" }}>Spotify - Reconnect</span>
        )}
        {!spotifyPlaybackAvailable && song.previewOnly && <span style={{ color: "#1db954" }}>Spotify · 30s</span>}
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div
          className="relative"
          style={{
            width: "58%",
            aspectRatio: "1",
            transform: isPlaying ? "scale(1)" : "scale(0.96)",
            transition: "transform 300ms",
          }}
        >
          {song.cover ? (
            <img
              src={song.cover}
              alt=""
              className="w-full h-full rounded"
              style={{
                objectFit: "cover",
                border: "1px solid #999",
                boxShadow: "0 4px 10px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.6) inset",
              }}
            />
          ) : (
            <div
              className="w-full h-full rounded flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, #6b6b6b, #2a2a2a)",
                color: "#bbb",
                border: "1px solid #333",
                boxShadow: "0 4px 10px rgba(0,0,0,0.35)",
              }}
            >
              <Music size={28} />
            </div>
          )}
        </div>
      </div>

      <div className="text-center mt-1 space-y-[1px]">
        <div className="truncate" style={{ fontWeight: 700 }}>{song.title}</div>
        <div className="truncate" style={{ color: "#444" }}>{song.artist}</div>
        <div className="truncate" style={{ color: "#777" }}>{song.album}</div>
      </div>

      <div className="mt-1">
        <div className="flex justify-between" style={{ fontSize: "9px", color: "#444" }}>
          <span>{fmt(progress)}</span>
          <span>-{fmt(Math.max(0, duration - progress))}</span>
        </div>
        <div
          className="w-full rounded-full overflow-hidden"
          style={{ height: "5px", background: "#b8c2cc", border: "1px solid #7a8592" }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: "100%",
              background: "linear-gradient(to bottom, #6a6a6a, #2a2a2a)",
              transition: "width 200ms linear",
            }}
          />
        </div>
        <div className="flex items-center gap-1 mt-1" style={{ fontSize: "9px", color: "#444" }}>
          <span>🔈</span>
          <div
            className="flex-1 rounded-full overflow-hidden"
            style={{ height: "4px", background: "#b8c2cc", border: "1px solid #7a8592" }}
          >
            <div
              style={{
                width: `${volume * 100}%`,
                height: "100%",
                background: "linear-gradient(to bottom, #6a6a6a, #2a2a2a)",
                transition: "width 120ms",
              }}
            />
          </div>
          <span>🔊</span>
        </div>
      </div>
    </div>
  );
}

// minimal typing for Battery API
interface BatteryManager extends EventTarget {
  level: number;
  charging: boolean;
}
