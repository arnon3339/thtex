import { useEffect, useRef, useState } from "react";
import { useRegisterSW } from "virtual:pwa-register/react";
import {
  XeLaTeXCompileError,
  XeLaTeXCompiler,
  type XeLaTeXStatusEvent,
} from "@arnon3339/thtex";

const starterDocument = String.raw`\documentclass[a4paper,12pt]{article}
\usepackage{fontspec}
\usepackage{xcolor}
\usepackage{geometry}
\usepackage{hyperref}

\geometry{margin=2.3cm}
\setmainfont{lmroman12-regular.otf}[
  Path=/fonts/,
  BoldFont=lmroman12-bold.otf,
  ItalicFont=lmroman12-italic.otf
]
\newfontfamily\thaifont{THSarabun.ttf}[
  Path=/fonts/,
  BoldFont=THSarabun-Bold.ttf,
  ItalicFont=THSarabun-Italic.ttf,
  BoldItalicFont=THSarabun-BoldItalic.ttf,
  Script=Thai
]

\definecolor{thtex}{HTML}{0F766E}
\hypersetup{colorlinks=true,urlcolor=thtex}

\begin{document}
\begin{center}
  {\Huge\bfseries ThTeX in the browser}\par
  \vspace{0.5em}
  {\large XeLaTeX + WebAssembly + React}
\end{center}

\vspace{1.5em}

This PDF was compiled locally in your browser. The source and document never
left your device.

\begin{quote}
  \thaifont\Large สวัสดีจาก XeLaTeX บนเว็บ
\end{quote}

\section*{What this example proves}
\begin{itemize}
  \item The XeTeX and xdvipdfmx engines run in a Web Worker.
  \item Fontspec, OpenType fonts, hyperlinks, geometry, and color are bundled.
  \item After the first complete visit, the PWA can reopen offline.
\end{itemize}

Learn more at \href{https://www.npmjs.com/package/@arnon3339/thtex}{npmjs.com/package/@arnon3339/thtex}.
\end{document}
`;

function formatBytes(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function App() {
  const compilerRef = useRef<XeLaTeXCompiler | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const [source, setSource] = useState(starterDocument);
  const [status, setStatus] = useState<XeLaTeXStatusEvent>({
    message: "Starting the XeLaTeX worker…",
    phase: "initializing",
  });
  const [ready, setReady] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(navigator.onLine);

  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  useEffect(() => {
    let cancelled = false;
    const compiler = new XeLaTeXCompiler({
      assetBaseUrl: new URL("xelatex/", document.baseURI),
      onStatus: setStatus,
    });
    compilerRef.current = compiler;

    compiler.ready
      .then(({ runtimeBytes, runtimeFileCount }) => {
        if (cancelled) return;
        setReady(true);
        setStatus({
          message: `Ready · ${runtimeFileCount} files · ${formatBytes(runtimeBytes)}`,
          phase: "ready",
          loadedBytes: runtimeBytes,
          totalBytes: runtimeBytes,
          loadedFiles: runtimeFileCount,
          totalFiles: runtimeFileCount,
        });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setError(reason instanceof Error ? reason.message : String(reason));
      });

    return () => {
      cancelled = true;
      compiler.dispose();
      compilerRef.current = null;
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const progress = status.totalBytes
    ? Math.min(100, Math.round(((status.loadedBytes ?? 0) / status.totalBytes) * 100))
    : ready
      ? 100
      : 0;

  async function compile() {
    const compiler = compilerRef.current;
    if (!compiler || !ready || compiling) return;

    setCompiling(true);
    setError(null);
    setLogs([]);

    try {
      const result = await compiler.compile(source, {
        passes: 1,
        onLog: ({ message, stream }) => {
          setLogs((current) => [...current, stream === "stderr" ? `[stderr] ${message}` : message]);
        },
      });
      const nextUrl = URL.createObjectURL(
        new Blob([result.pdf], { type: "application/pdf" }),
      );
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = nextUrl;
      setPdfUrl(nextUrl);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message);
      if (reason instanceof XeLaTeXCompileError && reason.log) {
        setLogs(reason.log.split("\n"));
      }
    } finally {
      setCompiling(false);
      setStatus((current) => ({
        ...current,
        message: "Ready for another document",
        phase: "ready",
      }));
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="ThTeX home">
          <span className="brand-mark" aria-hidden="true">T</span>
          <span>ThTeX</span>
          <span className="brand-note">React PWA</span>
        </a>
        <div className="connection" title={online ? "Network available" : "No network connection"}>
          <span className={online ? "signal online" : "signal"} />
          {online ? "Online" : "Offline"}
        </div>
      </header>

      <main>
        <section className="intro">
          <div>
            <p className="eyebrow">Browser-native typesetting</p>
            <h1>Write TeX. Get a PDF.<br />Keep everything local.</h1>
          </div>
          <p className="lede">
            A complete XeLaTeX workflow running as WebAssembly—no server,
            upload, or native installation required.
          </p>
        </section>

        <section className="runtime-card" aria-live="polite">
          <div className="runtime-copy">
            <span className={`status-dot ${ready ? "is-ready" : ""}`} />
            <div>
              <strong>{compiling ? "Compiling document…" : status.message}</strong>
              <span>{ready ? "XeTeX and xdvipdfmx are isolated in a Web Worker." : "The first visit downloads the offline runtime once."}</span>
            </div>
          </div>
          <div className="progress-track" aria-label="Runtime loading progress" aria-valuenow={progress} role="progressbar">
            <span style={{ width: `${progress}%` }} />
          </div>
        </section>

        {error && <div className="error-banner" role="alert"><strong>XeLaTeX stopped.</strong> {error}</div>}

        <section className="workspace">
          <article className="panel editor-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Source</span>
                <h2>main.tex</h2>
              </div>
              <button className="compile-button" onClick={compile} disabled={!ready || compiling}>
                {compiling ? <span className="spinner" aria-hidden="true" /> : <span aria-hidden="true">▶</span>}
                {compiling ? "Compiling" : ready ? "Compile PDF" : "Loading runtime"}
              </button>
            </div>
            <textarea
              aria-label="XeLaTeX source"
              spellCheck={false}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            />
          </article>

          <article className="panel preview-panel">
            <div className="panel-header">
              <div>
                <span className="panel-kicker">Output</span>
                <h2>PDF preview</h2>
              </div>
              {pdfUrl && <a className="download-link" href={pdfUrl} download="thtex-example.pdf">Download</a>}
            </div>
            <div className="preview-stage">
              {pdfUrl ? (
                <iframe title="Compiled PDF preview" src={pdfUrl} />
              ) : (
                <div className="empty-preview">
                  <div className="paper-stack" aria-hidden="true"><span>PDF</span></div>
                  <strong>Your document will appear here.</strong>
                  <span>{ready ? "Press Compile PDF to begin." : "The compiler is preparing its runtime."}</span>
                </div>
              )}
            </div>
          </article>
        </section>

        <details className="log-panel">
          <summary>Build log <span>{logs.length ? `${logs.length} lines` : "empty"}</span></summary>
          <pre>{logs.length ? logs.join("\n") : "Compile a document to see XeTeX output."}</pre>
        </details>
      </main>

      <footer>
        <span>Powered by <strong>thtex</strong></span>
        <span>Runs locally · Works offline after first load</span>
      </footer>

      {(offlineReady || needRefresh) && (
        <div className="pwa-toast" role="status">
          <div>
            <strong>{needRefresh ? "An update is ready" : "Ready to work offline"}</strong>
            <span>{needRefresh ? "Reload to use the newest runtime." : "This app can now reopen without a connection."}</span>
          </div>
          <div className="toast-actions">
            {needRefresh && <button onClick={() => void updateServiceWorker(true)}>Reload</button>}
            <button className="quiet" onClick={() => { setOfflineReady(false); setNeedRefresh(false); }}>Dismiss</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
