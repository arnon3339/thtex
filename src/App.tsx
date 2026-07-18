import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  XeLaTeXCompileError,
  XeLaTeXCompiler,
} from "./index.ts";

const initialSource = String.raw`\RequirePackage[OT1]{fontenc}
\documentclass{article}

\usepackage{xcolor}
\usepackage{geometry}
\usepackage{amsmath}

\geometry{margin=2cm}

\begin{document}

\section*{XeLaTeX WebAssembly}

Hello from \textbf{React and XeTeX WASM}.

\textcolor{blue}{
  This PDF was generated inside a Web Worker.
}

\[
E = mc^2
\]

\end{document}
`;

export default function App() {
  const compilerRef = useRef<XeLaTeXCompiler | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  const [source, setSource] = useState(initialSource);
  const [passes, setPasses] = useState(1);
  const [ready, setReady] = useState(false);
  const [compiling, setCompiling] = useState(false);
  const [status, setStatus] = useState(
    "Initializing worker…",
  );
  const [log, setLog] = useState("");
  const [pdfUrl, setPdfUrl] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let mounted = true;
    const compiler = new XeLaTeXCompiler({
      assetBaseUrl: "/xelatex/",
      onLog(event) {
        if (!mounted) return;

        const prefix = event.stream === "stderr" ? "[stderr] " : "";
        setLog((current) => `${current}${prefix}${event.message}\n`);
      },
      onStatus(event) {
        if (mounted) setStatus(event.message);
      },
    });

    compilerRef.current = compiler;
    void compiler.ready
      .then(() => {
        if (mounted) setReady(true);
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setReady(false);
        setStatus(
          error instanceof Error
            ? error.message
            : "The compiler could not initialize.",
        );
      });

    return () => {
      mounted = false;
      compiler.dispose();
      compilerRef.current = null;

      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, []);

  async function compile() {
    const compiler = compilerRef.current;

    if (!compiler || !ready || compiling) {
      return;
    }

    setCompiling(true);
    setStatus("Starting compilation…");
    setLog("");

    try {
      const result = await compiler.compile(source, { passes });
      const blob = new Blob([result.pdf], {
        type: "application/pdf",
      });
      const nextUrl = URL.createObjectURL(blob);

      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
      }

      pdfUrlRef.current = nextUrl;
      setPdfUrl(nextUrl);
      setLog(result.log);
      setStatus(`PDF generated · ${result.passes} XeTeX passes`);
    } catch (error) {
      setStatus(
        error instanceof Error ? error.message : "Compilation failed.",
      );

      if (error instanceof XeLaTeXCompileError) {
        setLog(error.log);
      }
    } finally {
      setCompiling(false);
    }
  }

  return (
    <main style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>ThTeX</h1>
          <p style={styles.subtitle}>
            React → Web Worker → XeTeX ×{passes} → xdvipdfmx
          </p>
        </div>

        <div style={styles.actions}>
          <label style={styles.passLabel}>
            XeTeX passes
            <select
              value={passes}
              onChange={(event) => setPasses(Number(event.target.value))}
              disabled={compiling}
              style={styles.select}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => void compile()}
            disabled={!ready || compiling}
            style={{
              ...styles.button,
              opacity: !ready || compiling ? 0.6 : 1,
            }}
          >
            {compiling ? "Compiling…" : "Compile PDF"}
          </button>
        </div>
      </header>

      <p style={styles.status}>{status}</p>

      <section style={styles.workspace}>
        <div style={styles.panel}>
          <h2 style={styles.panelTitle}>LaTeX source</h2>

          <textarea
            value={source}
            onChange={(event) =>
              setSource(event.target.value)
            }
            spellCheck={false}
            style={styles.textarea}
          />
        </div>

        <div style={styles.panel}>
          <h2 style={styles.panelTitle}>PDF preview</h2>

          {pdfUrl ? (
            <iframe
              title="Generated PDF"
              src={pdfUrl}
              style={styles.preview}
            />
          ) : (
            <div style={styles.placeholder}>
              Compile the document to display the PDF.
            </div>
          )}
        </div>
      </section>

      <section style={styles.logPanel}>
        <h2 style={styles.panelTitle}>Compiler output</h2>
        <pre style={styles.log}>{log || "No output yet."}</pre>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: 24,
    fontFamily: "system-ui, sans-serif",
    background: "#f5f5f5",
    color: "#181818",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
  },
  actions: {
    display: "flex",
    alignItems: "end",
    gap: 12,
  },
  passLabel: {
    display: "grid",
    gap: 4,
    color: "#555",
    fontSize: 12,
    fontWeight: 600,
    textAlign: "left",
  },
  select: {
    minWidth: 72,
    padding: "9px 10px",
    border: "1px solid #bbb",
    borderRadius: 8,
    background: "white",
    color: "#181818",
  },
  title: {
    margin: 0,
  },
  subtitle: {
    margin: "6px 0 0",
    color: "#666",
  },
  button: {
    minWidth: 140,
    padding: "10px 16px",
    border: "1px solid #222",
    borderRadius: 8,
    cursor: "pointer",
    background: "#222",
    color: "white",
    fontWeight: 600,
  },
  status: {
    margin: "16px 0",
    fontWeight: 600,
  },
  workspace: {
    display: "grid",
    gridTemplateColumns:
      "repeat(auto-fit, minmax(360px, 1fr))",
    gap: 16,
  },
  panel: {
    display: "flex",
    minHeight: 600,
    flexDirection: "column",
    overflow: "hidden",
    border: "1px solid #ddd",
    borderRadius: 10,
    background: "white",
  },
  panelTitle: {
    margin: 0,
    padding: "12px 14px",
    borderBottom: "1px solid #ddd",
    fontSize: 16,
  },
  textarea: {
    width: "100%",
    flex: 1,
    resize: "none",
    boxSizing: "border-box",
    padding: 14,
    border: 0,
    outline: "none",
    background: "white",
    color: "#181818",
    fontFamily: "monospace",
    fontSize: 14,
    lineHeight: 1.5,
  },
  preview: {
    width: "100%",
    flex: 1,
    border: 0,
  },
  placeholder: {
    display: "grid",
    flex: 1,
    placeItems: "center",
    padding: 24,
    color: "#777",
  },
  logPanel: {
    marginTop: 16,
    overflow: "hidden",
    border: "1px solid #ddd",
    borderRadius: 10,
    background: "white",
  },
  log: {
    maxHeight: 300,
    margin: 0,
    overflow: "auto",
    padding: 14,
    whiteSpace: "pre-wrap",
    fontSize: 12,
  },
};
