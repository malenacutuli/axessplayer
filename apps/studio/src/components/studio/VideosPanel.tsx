// My videos (platform v2): upload any video, vertical or horizontal, straight to Cloudflare Stream; see each
// one move from uploading to processing to ready (orientation, short/long, captions generated
// automatically); publish, unpublish, or delete. Viewers only ever see published + ready videos.
// No em dashes.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { useContentClient } from "../../api/useContentClient.js";
import { ContentApiError, type StudioVideo } from "../../api/client.js";
import { tusUpload } from "../../api/streamUpload.js";

type Upload = { name: string; progress: number; error?: string };

function statusLabel(v: StudioVideo): string {
  if (v.status === "error") return "Processing failed";
  if (v.status !== "ready") return "Processing on Stream";
  const shape = v.orientation === "vertical" ? "Vertical" : v.orientation === "square" ? "Square" : "Horizontal";
  return `${shape} ${v.format === "short" ? "short" : "video"}`;
}

export function VideosPanel(): JSX.Element {
  const client = useContentClient();
  const [videos, setVideos] = useState<StudioVideo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [language, setLanguage] = useState("en");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refresh = useCallback(async () => {
    try {
      setVideos(await client.listMyVideos());
      setError(null);
    } catch (e) {
      setError(e instanceof ContentApiError && e.status === 401 ? "Sign in to manage your videos." : "Could not load your videos.");
    }
  }, [client]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // While anything is still processing, check back every 10 seconds.
  useEffect(() => {
    if (!videos?.some((v) => v.status === "uploading")) return;
    const t = setInterval(() => void refresh(), 10_000);
    return () => clearInterval(t);
  }, [videos, refresh]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file || !title.trim()) return;
    setUpload({ name: file.name, progress: 0 });
    try {
      const started = await client.createVideo({ title: title.trim(), description: description.trim() || undefined, language, size_bytes: file.size, name: file.name });
      await tusUpload(file, started.upload_url, (p) => setUpload({ name: file.name, progress: p }));
      setUpload(null);
      setTitle("");
      setDescription("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (err) {
      const msg =
        err instanceof ContentApiError
          ? err.status === 501
            ? "Video uploads are not configured on the server yet."
            : (err.apiError ?? `Upload failed (${err.status}).`)
          : err instanceof Error
            ? err.message
            : "Upload failed.";
      setUpload({ name: file.name, progress: 0, error: msg });
    }
  };

  const setVisibility = async (v: StudioVideo, visibility: "draft" | "published") => {
    try {
      const updated = await client.updateVideo(v.id, { visibility });
      setVideos((list) => list?.map((x) => (x.id === v.id ? updated : x)) ?? null);
    } catch {
      setError("Could not update the video.");
    }
  };

  const remove = async (v: StudioVideo) => {
    if (!window.confirm(`Delete "${v.title}"? This cannot be undone.`)) return;
    try {
      await client.deleteVideo(v.id);
      setVideos((list) => list?.filter((x) => x.id !== v.id) ?? null);
    } catch {
      setError("Could not delete the video.");
    }
  };

  return (
    <section className="panel" aria-labelledby="videos-h" data-testid="videos-panel">
      <h2 id="videos-h">My videos</h2>
      <p className="muted">Upload any video, vertical or horizontal. Captions are generated automatically; viewers see a video once you publish it and processing is done.</p>

      <form onSubmit={onSubmit} className="vupload" aria-describedby="vupload-help">
        <div className="fld">
          <label htmlFor="v-file">Video file</label>
          <input id="v-file" ref={fileRef} type="file" accept="video/*" required />
        </div>
        <div className="fld">
          <label htmlFor="v-title">Title</label>
          <input id="v-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} required />
        </div>
        <div className="fld">
          <label htmlFor="v-desc">Description</label>
          <textarea id="v-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} rows={3} />
        </div>
        <div className="fld">
          <label htmlFor="v-lang">Spoken language</label>
          <select id="v-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
            {["en", "es", "fr", "de", "it", "pt", "ja", "ko", "zh", "ar", "hi"].map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <p id="vupload-help" className="muted">The spoken language decides the automatic captions.</p>
        <button type="submit" className="btn primary" disabled={upload != null && !upload.error} data-testid="v-upload">
          Upload
        </button>
        {upload && !upload.error && (
          <p role="status" data-testid="v-progress">
            Uploading {upload.name}: {Math.round(upload.progress * 100)}%
          </p>
        )}
        {upload?.error && (
          <p role="alert" className="err" data-testid="v-upload-error">
            {upload.error}
          </p>
        )}
      </form>

      {error && (
        <p role="alert" className="err">
          {error}
        </p>
      )}
      {videos && videos.length === 0 && <p className="muted">No videos yet.</p>}
      {videos && videos.length > 0 && (
        <ul className="vlist" data-testid="v-list">
          {videos.map((v) => (
            <li key={v.id} className="vlist__row">
              <span className="vlist__thumb" style={{ backgroundImage: v.thumbnail_url ? `url(${v.thumbnail_url})` : undefined }} aria-hidden />
              <span className="vlist__body">
                <strong>{v.title}</strong>
                <span className="muted">
                  {statusLabel(v)}
                  {v.status === "ready" && (v.accessibility.captions ? ", captions requested" : ", captions unavailable")}
                  {v.visibility === "published" ? ", published" : ", draft"}
                </span>
              </span>
              <span className="vlist__actions">
                {v.visibility === "draft" ? (
                  <button className="btn" disabled={v.status !== "ready"} onClick={() => void setVisibility(v, "published")} aria-label={`Publish ${v.title}`}>
                    Publish
                  </button>
                ) : (
                  <button className="btn" onClick={() => void setVisibility(v, "draft")} aria-label={`Unpublish ${v.title}`}>
                    Unpublish
                  </button>
                )}
                <button className="btn ghost" onClick={() => void remove(v)} aria-label={`Delete ${v.title}`}>
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
