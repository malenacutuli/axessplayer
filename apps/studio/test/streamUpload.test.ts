// The studio's Stream upload: one server call to start (size + name + cut settings, never a user id), then the
// file goes to the returned one-time tus URL. No em dashes.
import { describe, it, expect } from "vitest";
import { uploadToStream, STREAM_CHUNK_BYTES } from "../src/api/streamUpload.js";

describe("uploadToStream", () => {
  it("starts the upload on the server, then sends the file to the returned tus URL", async () => {
    const calls: Array<{ beatId: string; body: Record<string, unknown> }> = [];
    const client = {
      async startStreamUpload(beatId: string, body: Record<string, unknown>) {
        calls.push({ beatId, body });
        return { variant: { id: "v1", playback_url: "stream:u1" } as never, upload_url: "https://upload.example/tus/u1", stream_uid: "u1" };
      },
    };
    const sent: Array<{ url: string; size: number }> = [];
    const file = new File([new Uint8Array(1024)], "ep1.mp4", { type: "video/mp4" });
    const out = await uploadToStream(client as never, "beat-1", file, { tier: "A_filmed", is_premium: true }, {
      uploadFile: async (f, url) => {
        sent.push({ url, size: f.size });
      },
    });
    expect(calls).toEqual([{ beatId: "beat-1", body: { tier: "A_filmed", is_premium: true, size_bytes: 1024, name: "ep1.mp4" } }]);
    expect(sent).toEqual([{ url: "https://upload.example/tus/u1", size: 1024 }]);
    expect(out.stream_uid).toBe("u1");
  });
  it("uses a chunk size Stream accepts (>= 5 MiB, multiple of 256 KiB)", () => {
    expect(STREAM_CHUNK_BYTES).toBeGreaterThanOrEqual(5 * 1024 * 1024);
    expect(STREAM_CHUNK_BYTES % (256 * 1024)).toBe(0);
  });
});
