// My videos: lists the creator's videos (drafts included), only lets a READY draft be published, and
// explains when uploads are not configured on the server. No em dashes.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ContentClient } from "../src/api/client.js";
import { ContentClientContext } from "../src/api/useContentClient.js";
import { VideosPanel } from "../src/components/studio/VideosPanel.js";

const video = (over: Record<string, unknown>) => ({
  id: "v1",
  title: "Ready draft",
  description: null,
  orientation: "horizontal",
  duration_ms: 60000,
  format: "long",
  language: "en",
  thumbnail_url: null,
  visibility: "draft",
  status: "ready",
  views: 0,
  accessibility: { captions: true, audio_description: false, sign: false, dubs: [] },
  ...over,
});

function fakeFetch(items: Array<Record<string, unknown>>) {
  const patches: Array<{ id: string; body: unknown }> = [];
  const f = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input), "http://content.test");
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (url.pathname === "/me/videos") return json(200, { items });
    const m = /^\/videos\/([^/]+)$/.exec(url.pathname);
    if (m && init.method === "PATCH") {
      const body = JSON.parse(String(init.body));
      patches.push({ id: m[1], body });
      const v = items.find((i) => i.id === m[1])!;
      Object.assign(v, body);
      return json(200, v);
    }
    if (url.pathname === "/videos" && init.method === "POST") return json(501, { error: "stream_not_configured" });
    return json(404, { error: "not_found" });
  });
  return { f: f as unknown as typeof fetch, patches };
}

function mount(items: Array<Record<string, unknown>>) {
  const { f, patches } = fakeFetch(items);
  const client = new ContentClient({ baseUrl: "http://content.test", fetchImpl: f });
  render(
    <ContentClientContext.Provider value={client}>
      <VideosPanel />
    </ContentClientContext.Provider>,
  );
  return patches;
}

afterEach(() => cleanup());

describe("VideosPanel", () => {
  it("lists drafts and publishes a ready one", async () => {
    const patches = mount([video({}), video({ id: "v2", title: "Still processing", status: "uploading", orientation: null, format: null })]);
    const list = await screen.findByTestId("v-list");
    expect(within(list).getByText("Ready draft")).toBeInTheDocument();
    expect(within(list).getByRole("button", { name: "Publish Still processing" })).toBeDisabled();
    await userEvent.click(within(list).getByRole("button", { name: "Publish Ready draft" }));
    expect(patches).toEqual([{ id: "v1", body: { visibility: "published" } }]);
    expect(await within(list).findByRole("button", { name: "Unpublish Ready draft" })).toBeInTheDocument();
  });

  it("explains when uploads are not configured on the server", async () => {
    mount([]);
    await screen.findByText("No videos yet.");
    const file = new File([new Uint8Array(10)], "clip.mp4", { type: "video/mp4" });
    await userEvent.upload(screen.getByLabelText("Video file"), file);
    await userEvent.type(screen.getByLabelText("Title"), "My clip");
    // jsdom treats a required file input as empty even with files set, so submit the form directly.
    fireEvent.submit(screen.getByTestId("v-upload").closest("form")!);
    expect(await screen.findByTestId("v-upload-error")).toHaveTextContent("not configured");
  });
});
