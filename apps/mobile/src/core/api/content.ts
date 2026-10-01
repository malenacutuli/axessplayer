// Typed client for the content service v2 endpoints. Guests can call every one of these: the bearer is
// attached only when signed in (http.ts). No em dashes.

import { createHttp, type ApiResult, type HttpOptions } from "./http";
import { parseHomeFeed, parsePlayback, parseShortsPage, parseVideo } from "./parse";
import type { HomeFeed, Playback, ShortsPage, Video } from "./types";

export interface ContentClient {
  getShorts(cursor?: string | null): Promise<ApiResult<ShortsPage>>;
  getHome(): Promise<ApiResult<HomeFeed>>;
  getVideo(id: string): Promise<ApiResult<Video>>;
  getPlayback(id: string): Promise<ApiResult<Playback>>;
}

export function createContentClient(baseUrl: string, opts: HttpOptions): ContentClient {
  const http = createHttp(opts);
  const base = baseUrl.replace(/\/+$/, "");
  const vid = (id: string) => `${base}/videos/${encodeURIComponent(id)}`;
  return {
    getShorts: (cursor) =>
      http.request(
        {
          method: "GET",
          url: cursor ? `${base}/feed/shorts?cursor=${encodeURIComponent(cursor)}` : `${base}/feed/shorts`,
        },
        parseShortsPage
      ),
    getHome: () => http.request({ method: "GET", url: `${base}/feed/home` }, parseHomeFeed),
    getVideo: (id) => http.request({ method: "GET", url: vid(id) }, parseVideo),
    getPlayback: (id) => http.request({ method: "GET", url: `${vid(id)}/playback` }, parsePlayback),
  };
}
