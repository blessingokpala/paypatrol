import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Loader2, Maximize2, ZoomIn, ZoomOut } from "lucide-react";

type Kind = "pdf" | "image" | "other";
type Loaded = { url: string; kind: Kind; size: number; type: string };

function kindOf(type: string, name: string): Kind {
  if (type === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name)) return "image";
  return "other";
}
function fmtSize(b: number) {
  return b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(0)} KB` : `${(b / 1048576).toFixed(1)} MB`;
}

/** Downloads the private file through the signed-in session (storage access rules apply); never creates a public link. */
function useDocument(path: string, name: string) {
  const [state, setState] = useState<{ status: "loading" } | { status: "error"; msg: string } | ({ status: "ready" } & Loaded)>({ status: "loading" });
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    setState({ status: "loading" });
    supabase.storage.from("invoices").download(path).then(({ data, error }) => {
      if (!live) return;
      if (error || !data) { setState({ status: "error", msg: "This document is unavailable or you don't have access to it." }); return; }
      url = URL.createObjectURL(data);
      setState({ status: "ready", url, kind: kindOf(data.type, name), size: data.size, type: data.type || "unknown" });
    });
    return () => { live = false; if (url) setTimeout(() => URL.revokeObjectURL(url!), 30_000); };
  }, [path, name]);
  return state;
}

function PdfPages({ url, zoom, page, setPages, onError }: { url: string; zoom: number; page: number; setPages: (n: number) => void; onError: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const docRef = useRef<import("pdfjs-dist").PDFDocumentProxy | null>(null);
  const [ready, setReady] = useState(0);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const doc = await pdfjs.getDocument({ url }).promise;
        if (!live) return;
        docRef.current = doc;
        setPages(doc.numPages);
        setReady((r) => r + 1);
      } catch { if (live) onError(); }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  useEffect(() => {
    const doc = docRef.current;
    const c = canvas.current;
    if (!doc || !c) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      try {
        const pg = await doc.getPage(page);
        const width = c.parentElement?.clientWidth ?? 600;
        const base = pg.getViewport({ scale: 1 });
        const scale = (width / base.width) * zoom;
        const dpr = window.devicePixelRatio || 1;
        const vp = pg.getViewport({ scale: scale * dpr });
        c.width = vp.width; c.height = vp.height;
        c.style.width = `${vp.width / dpr}px`; c.style.height = `${vp.height / dpr}px`;
        task = pg.render({ canvasContext: c.getContext("2d")!, viewport: vp, canvas: c } as never);
        await task.promise;
      } catch (e) { if ((e as Error)?.name !== "RenderingCancelledException") onError(); }
    })();
    return () => task?.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, page, zoom]);
  return <canvas ref={canvas} className="mx-auto block bg-card shadow-sm" aria-label={`Document page ${page}`} />;
}

function Viewer({ doc, tall }: { doc: Loaded; tall?: boolean }) {
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [failed, setFailed] = useState(false);
  const z = (d: number) => setZoom((v) => Math.min(3, Math.max(0.5, +(v + d).toFixed(2))));
  if (doc.kind === "other" || failed) {
    return <p className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">{failed ? "The preview couldn't be shown." : "Preview isn't available for this file type."} Use “Open full document” instead.</p>;
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Document controls">
        {doc.kind === "pdf" && (
          <>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <span className="min-w-20 text-center text-xs tabular-nums" aria-live="polite">Page {page} of {pages}</span>
            <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
            <span className="mx-1 h-5 w-px bg-border" aria-hidden />
          </>
        )}
        <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Zoom out" disabled={zoom <= 0.5} onClick={() => z(-0.25)}><ZoomOut className="h-4 w-4" /></Button>
        <span className="w-12 text-center text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
        <Button size="icon" variant="outline" className="h-8 w-8" aria-label="Zoom in" disabled={zoom >= 3} onClick={() => z(0.25)}><ZoomIn className="h-4 w-4" /></Button>
      </div>
      <div className={`overflow-auto rounded-md border bg-muted p-2 ${tall ? "h-[calc(100dvh-11rem)]" : "max-h-[640px]"}`}>
        {doc.kind === "pdf"
          ? <PdfPages url={doc.url} zoom={zoom} page={page} setPages={setPages} onError={() => setFailed(true)} />
          : <img src={doc.url} alt="Uploaded document" onError={() => setFailed(true)} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} className="mx-auto block" />}
      </div>
    </div>
  );
}

export function DocumentViewer({ path, fileName, uploadedAt, uploadedBy }: { path: string; fileName: string; uploadedAt: string; uploadedBy?: string | undefined }) {
  const state = useDocument(path, fileName);
  const [open, setOpen] = useState(false);
  const openFull = async () => {
    if (state.status === "ready") { window.open(state.url, "_blank", "noopener"); return; }
    const w = window.open("", "_blank");
    const { data } = await supabase.storage.from("invoices").createSignedUrl(path, 120);
    if (data && w) w.location.href = data.signedUrl; else w?.close();
  };
  const meta = [
    state.status === "ready" ? (state.kind === "pdf" ? "PDF" : state.kind === "image" ? state.type.replace("image/", "").toUpperCase() + " image" : state.type) : null,
    state.status === "ready" ? fmtSize(state.size) : null,
    `uploaded ${new Date(uploadedAt).toLocaleString("en-CA")}`,
    uploadedBy ? `by ${uploadedBy}` : null,
  ].filter(Boolean).join(" · ");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 break-all text-sm font-semibold"><FileText className="h-4 w-4 shrink-0" aria-hidden />{fileName}</p>
          <p className="text-xs text-muted-foreground">{meta}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void openFull()}><ExternalLink className="mr-1 h-4 w-4" />Open full document</Button>
      </div>
      {state.status === "loading" && <p className="flex items-center gap-2 rounded-md border bg-muted p-4 text-sm text-muted-foreground" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" />Loading document preview…</p>}
      {state.status === "error" && <p className="rounded-md border border-warning/40 bg-warning-soft p-3 text-sm" role="alert">{state.msg} Try “Open full document”.</p>}
      {state.status === "ready" && (
        <>
          <div className="hidden md:block"><Viewer doc={state} /></div>
          <div className="md:hidden">
            {state.kind === "image" && <img src={state.url} alt="" className="mb-2 max-h-40 w-full rounded-md border bg-muted object-contain" />}
            <Button className="w-full" onClick={() => setOpen(true)}><Maximize2 className="mr-1 h-4 w-4" />View document</Button>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogContent className="max-h-[100dvh] w-[100vw] max-w-[100vw] gap-2 p-3 sm:max-w-3xl">
              <DialogTitle className="truncate pr-8 text-sm">{fileName}</DialogTitle>
              <DialogDescription className="sr-only">Original uploaded document</DialogDescription>
              <Viewer doc={state} tall />
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
