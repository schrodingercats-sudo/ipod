import { useRef, useState, useEffect } from "react";
import { IPod, Song } from "./components/ipod";

const generateRandomString = (length: number) => {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

const sha256 = async (plain: string) => {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  return window.crypto.subtle.digest('SHA-256', data)
}

const base64encode = (input: ArrayBuffer) => {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

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
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (code) {
      const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
      const redirectUri = window.location.origin + "/";
      const codeVerifier = localStorage.getItem('code_verifier');

      if (!codeVerifier || !clientId) return;

      const exchangeToken = async () => {
        try {
          const payload = {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              client_id: clientId,
              grant_type: 'authorization_code',
              code,
              redirect_uri: redirectUri,
              code_verifier: codeVerifier,
            }),
          }

          const body = await fetch('https://accounts.spotify.com/api/token', payload);
          const response = await body.json();

          if (response.access_token) {
            window.history.replaceState({}, document.title, window.location.pathname);
            loadSpotify(response.access_token);
          } else {
            setSpotifyError("Failed to authenticate with Spotify.");
          }
        } catch (error) {
          setSpotifyError("Failed to exchange code for token.");
        }
      };

      exchangeToken();
    }
  }, []);

  const handleSpotifyConnect = async () => {
    const clientId = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
    if (!clientId) {
      setSpotifyError("Spotify Client ID is not configured.");
      return;
    }
    const redirectUri = window.location.origin + "/";

    const codeVerifier = generateRandomString(64);
    const hashed = await sha256(codeVerifier);
    const codeChallenge = base64encode(hashed);

    window.localStorage.setItem('code_verifier', codeVerifier);

    const authUrl = new URL("https://accounts.spotify.com/authorize");
    const params = {
      response_type: 'code',
      client_id: clientId,
      scope: 'user-library-read',
      code_challenge_method: 'S256',
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
    };

    authUrl.search = new URLSearchParams(params).toString();
    window.location.href = authUrl.toString();
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
