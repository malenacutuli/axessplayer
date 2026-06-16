// Attach a source to a <video>, using hls.js for HLS (.m3u8) where the browser cannot play it natively
// (everywhere except Safari). hls.js is dynamically imported so it only loads when an HLS source plays.
// Returns a cleanup function and reports status via onStatus so the player can show WHY a frame did or did
// not paint (the black-player diagnosis), on screen and in the console. No em dashes.

export type HlsStatus =
  | "loading"
  | "parsed"
  | "playing"
  | "autoplay-blocked"
  | `error: ${string}`
  | `import-failed`
  | "unsupported";

export async function attachHls(
  video: HTMLVideoElement,
  url: string,
  onStatus?: (s: HlsStatus) => void,
): Promise<() => void> {
  const report = (s: HlsStatus) => {
    try {
      onStatus?.(s);
    } catch {
      /* never let a status callback break playback */
    }
  };
  const isHls = /\.m3u8(\?|$)/i.test(url);
  report("loading");

  // Native HLS (Safari) or a plain video file: set src directly and play.
  if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = url;
    video.addEventListener("playing", () => report("playing"), { once: true });
    video.play?.()?.catch?.((err: unknown) => {
      report("autoplay-blocked");
      console.warn("[player] native play blocked", (err as Error)?.message, url);
    });
    return () => {
      video.removeAttribute("src");
      video.load?.();
    };
  }

  let Hls: typeof import("hls.js").default;
  try {
    Hls = (await import("hls.js")).default;
  } catch (err) {
    report("import-failed");
    console.error("[player] hls.js failed to load", err);
    video.src = url;
    return () => {};
  }

  if (!Hls.isSupported()) {
    report("unsupported");
    console.warn("[player] hls.js not supported; trying native src", url);
    video.src = url;
    return () => {};
  }

  const hls = new Hls({ enableWorker: true });
  video.addEventListener("playing", () => report("playing"), { once: true });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    const detail = `${data?.type ?? "?"}/${data?.details ?? "?"}${data?.fatal ? " FATAL" : ""}`;
    report(`error: ${detail}`);
    console.error("[player] hls.js error", {
      type: data?.type,
      details: data?.details,
      fatal: data?.fatal,
      url,
      response: (data as { response?: { code?: number; text?: string } })?.response,
    });
  });
  hls.on(Hls.Events.MANIFEST_PARSED, () => {
    report("parsed");
    console.info("[player] hls manifest parsed, starting playback", url);
    video.play?.()?.catch?.((err: unknown) => {
      report("autoplay-blocked");
      console.warn("[player] autoplay blocked (tap to play)", (err as Error)?.message);
    });
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => hls.destroy();
}
