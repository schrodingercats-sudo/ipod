import { useRef, useState, useEffect } from "react";
import { IPod, Song } from "./components/ipod";

export default function App() {
  const [songs, setSongs] = useState<Song[]>([]);
  const [spotifyConnected, setSpotifyConnected] = useState(false);
  const [spotifyError, setSpotifyError] = useState<string | null>(null);
  const [spotifyLoading, setSpotifyLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    const imported: Song[] = [];
    for (const f of Array.from(files)) {
      if (!f.type.startsWith("audio/")) continue;
      const url = URL.createObjectURL(f);
      const name = f.name.replace(/\.[^.]+$/, "");
      // parse "Artist - Title" convention
      const parts = name.split(" - ");
      const title = parts.length > 1 ? parts.slice(1).join(" - ") : name;
      const artist = parts.length > 1 ? parts[0] : "Unknown Artist";
      const duration = await new Promise<number>((resolve) => {
        const a = document.createElement("audio");
        a.preload = "metadata";
        a.src = url;
        a.onloadedmetadata = () => resolve(a.duration || 0);
        a.onerror = () => resolve(0);
      });
      imported.push({
        id: `local-${Date.now()}-${Math.random()}`,
        title,
        artist,
        album: "Imported",
        url,
        duration,
        source: "local",
      });
    }
    if (imported.length) setSongs((s) => [...s, ...imported]);
  };

  useEffect(() => {
    // Check if returning from Spotify auth
    const hash = window.location.hash;
    if (hash) {
      const params = new URLSearchParams(hash.substring(1));
      const token = params.get("access_token");
      if (token) {
        window.history.replaceState({}, document.title, window.location.pathname);
        loadSpotify(token);
      }
    }
  }, []);

  const handleSpotifyConnect = () => {
    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
    if (!clientId) {
      setSpotifyError("Spotify Client ID is not configured.");
      return;
    }
    const redirectUri = window.location.origin + "/";
    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=token&redirect_uri=${encodeURIComponent(
      redirectUri
    )}&scope=user-library-read`;
    window.location.href = authUrl;
  };

  const loadSpotify = async (token: string) => {
    setSpotifyLoading(true);
    setSpotifyError(null);
    try {
      const res = await fetch("https://api.spotify.com/v1/me/tracks?limit=50", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Spotify responded ${res.status}`);
      const data = await res.json();
      const imported: Song[] = (data.items || [])
        .map((it: any) => it.track)
        .filter((t: any) => t && t.preview_url)
        .map((t: any) => ({
          id: `spotify-${t.id}`,
          title: t.name,
          artist: (t.artists || []).map((a: any) => a.name).join(", "),
          album: t.album?.name ?? "",
          url: t.preview_url,
          duration: 30,
          cover: t.album?.images?.[0]?.url,
          source: "spotify" as const,
          previewOnly: true,
        }));
      if (!imported.length) {
        setSpotifyError("No tracks with preview available in your saved tracks.");
      } else {
        setSongs((s) => [...s, ...imported]);
        setSpotifyConnected(true);
      }
    } catch (e: any) {
      setSpotifyError(e.message || "Failed to connect.");
    } finally {
      setSpotifyLoading(false);
    }
  };

  return (
    <div
      className="size-full min-h-screen flex items-center justify-center p-4"
      style={{
        background:
          "radial-gradient(ellipse at center, #3a3a3a 0%, #1a1a1a 70%, #070707 100%)",
      }}
    >
      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          handleFiles(e.target.files);
          if (fileRef.current) fileRef.current.value = "";
        }}
      />

      <div className="flex flex-col items-center gap-5">
        <IPod
          songs={songs}
          onImportFiles={() => fileRef.current?.click()}
          onConnectSpotify={handleSpotifyConnect}
          spotifyConnected={spotifyConnected}
        />
        <div className="text-white/55 text-center max-w-sm" style={{ fontSize: "11px" }}>
          Drag around the wheel to scroll · tap labels for prev/next/play/menu · center selects.
          Keyboard: ↑↓ Enter Esc Space.
        </div>
        {spotifyError && (
          <div className="text-red-400 text-center text-xs mt-2">{spotifyError}</div>
        )}
      </div>
    </div>
  );
}
