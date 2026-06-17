// P4-T2 spec test: accessibility track URLs derive from the master URL plus the files actually present in
// the media dir. Absent tracks are omitted (never a dangling URL); only the ASL sign base is attached.
// No em dashes.

import { describe, it, expect } from "vitest";
import { deriveTrackUrls } from "./media.js";

const MASTER = "http://127.0.0.1:8095/media/abc123/master.m3u8";
const DIR = "http://127.0.0.1:8095/media/abc123/";

describe("deriveTrackUrls", () => {
  it("attaches each track present in the media dir", () => {
    const t = deriveTrackUrls(MASTER, ["master.m3u8", "captions.json", "ad.json", "asl_sign.webm", "es_dub.m4a", "fr_dub.m4a"]);
    expect(t.caption_doc_url).toBe(`${DIR}captions.json`);
    expect(t.audio_description_url).toBe(`${DIR}ad.json`);
    expect(t.sign_video_url).toBe(`${DIR}asl_sign.webm`);
    expect(t.dub_audio_urls).toEqual({ es: `${DIR}es_dub.m4a`, fr: `${DIR}fr_dub.m4a` });
  });

  it("omits any track whose file is absent (never a dangling URL)", () => {
    const t = deriveTrackUrls(MASTER, ["master.m3u8", "captions.json"]);
    expect(t.caption_doc_url).toBe(`${DIR}captions.json`);
    expect(t.audio_description_url).toBeUndefined();
    expect(t.sign_video_url).toBeUndefined();
    expect(t.dub_audio_urls).toBeUndefined();
  });

  it("returns an empty object when only the master is present", () => {
    expect(deriveTrackUrls(MASTER, ["master.m3u8"])).toEqual({});
  });

  it("attaches only the ASL sign base (PSL/LSA are derived client-side)", () => {
    const t = deriveTrackUrls(MASTER, ["asl_sign.webm", "psl_sign.webm", "lsa_sign.webm"]);
    expect(t.sign_video_url).toBe(`${DIR}asl_sign.webm`);
  });
});
