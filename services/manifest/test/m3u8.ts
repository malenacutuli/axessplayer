// A strict, standalone HLS playlist parser used by the tests to validate that the manifest service emits
// spec-valid playlists, rather than asserting on raw strings. It parses both media playlists and
// multivariant (master) playlists per RFC 8216 and throws on structural violations. Kept dependency free
// so the service needs no extra package and no lockfile change. No em dashes.

export interface ParsedSegment {
  duration: number;
  uri: string;
}

export interface ParsedStream {
  bandwidth: number;
  resolution?: string;
  codecs?: string;
  uri: string;
}

export interface ParsedMediaPlaylist {
  kind: "media";
  version: number;
  targetDuration: number;
  mediaSequence: number;
  playlistType?: string;
  independentSegments: boolean;
  mapUri?: string;
  segments: ParsedSegment[];
  endList: boolean;
}

export interface ParsedMasterPlaylist {
  kind: "master";
  version: number;
  independentSegments: boolean;
  streams: ParsedStream[];
}

export type ParsedPlaylist = ParsedMediaPlaylist | ParsedMasterPlaylist;

function parseAttributes(value: string): Record<string, string> {
  // Split on commas not inside quotes, then on the first equals sign.
  const out: Record<string, string> = {};
  const parts = value.match(/(?:[^,"]+|"[^"]*")+/g) ?? [];
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    let val = part.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    out[key] = val;
  }
  return out;
}

export function parseM3U8(text: string): ParsedPlaylist {
  const rawLines = text.split("\n");
  // Trailing newline produces a final empty element; drop pure-empty lines.
  const lines = rawLines.map((l) => l.replace(/\r$/, "")).filter((l, i) => l.length > 0 || i === 0);

  if (lines.length === 0 || lines[0] !== "#EXTM3U") {
    throw new Error("playlist must start with #EXTM3U");
  }

  let version = 1;
  let independentSegments = false;
  let targetDuration: number | undefined;
  let mediaSequence = 0;
  let playlistType: string | undefined;
  let mapUri: string | undefined;
  let endList = false;
  const segments: ParsedSegment[] = [];
  const streams: ParsedStream[] = [];

  let pendingDuration: number | undefined;
  let pendingStream: Omit<ParsedStream, "uri"> | undefined;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0) continue;

    if (line.startsWith("#")) {
      if (line.startsWith("#EXT-X-VERSION:")) {
        version = Number(line.slice("#EXT-X-VERSION:".length));
      } else if (line === "#EXT-X-INDEPENDENT-SEGMENTS") {
        independentSegments = true;
      } else if (line.startsWith("#EXT-X-TARGETDURATION:")) {
        targetDuration = Number(line.slice("#EXT-X-TARGETDURATION:".length));
      } else if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) {
        mediaSequence = Number(line.slice("#EXT-X-MEDIA-SEQUENCE:".length));
      } else if (line.startsWith("#EXT-X-PLAYLIST-TYPE:")) {
        playlistType = line.slice("#EXT-X-PLAYLIST-TYPE:".length);
      } else if (line.startsWith("#EXT-X-MAP:")) {
        const attrs = parseAttributes(line.slice("#EXT-X-MAP:".length));
        if (!attrs.URI) throw new Error("EXT-X-MAP missing URI");
        mapUri = attrs.URI;
      } else if (line.startsWith("#EXTINF:")) {
        const dur = Number(line.slice("#EXTINF:".length).split(",")[0]);
        if (!Number.isFinite(dur) || dur <= 0) throw new Error(`invalid EXTINF duration: ${line}`);
        pendingDuration = dur;
      } else if (line.startsWith("#EXT-X-STREAM-INF:")) {
        const attrs = parseAttributes(line.slice("#EXT-X-STREAM-INF:".length));
        if (!attrs.BANDWIDTH) throw new Error("EXT-X-STREAM-INF missing BANDWIDTH");
        pendingStream = {
          bandwidth: Number(attrs.BANDWIDTH),
          resolution: attrs.RESOLUTION,
          codecs: attrs.CODECS,
        };
      } else if (line === "#EXT-X-ENDLIST") {
        endList = true;
      }
      continue;
    }

    // Non-tag line is a URI. It must resolve a pending EXTINF (media) or STREAM-INF (master).
    if (pendingStream) {
      streams.push({ ...pendingStream, uri: line });
      pendingStream = undefined;
    } else if (pendingDuration !== undefined) {
      segments.push({ duration: pendingDuration, uri: line });
      pendingDuration = undefined;
    } else {
      throw new Error(`URI line without a preceding EXTINF or EXT-X-STREAM-INF: ${line}`);
    }
  }

  if (pendingDuration !== undefined) throw new Error("dangling EXTINF with no segment URI");
  if (pendingStream) throw new Error("dangling EXT-X-STREAM-INF with no URI");

  if (streams.length > 0) {
    if (segments.length > 0) throw new Error("playlist mixes master streams and media segments");
    return { kind: "master", version, independentSegments, streams };
  }

  if (targetDuration === undefined) throw new Error("media playlist missing EXT-X-TARGETDURATION");
  for (const seg of segments) {
    if (seg.duration > targetDuration + 1e-9) {
      throw new Error(`segment duration ${seg.duration} exceeds TARGETDURATION ${targetDuration}`);
    }
  }
  if (!endList) throw new Error("VOD media playlist missing EXT-X-ENDLIST");

  return {
    kind: "media",
    version,
    targetDuration,
    mediaSequence,
    playlistType,
    independentSegments,
    mapUri,
    segments,
    endList,
  };
}
