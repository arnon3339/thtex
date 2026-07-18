# ThTeX

[![Live Demo](https://img.shields.io/badge/Live_Demo-thtex.pages.dev-F38020?logo=cloudflarepages&logoColor=white)](https://thtex.pages.dev/)
[![npm](https://img.shields.io/npm/v/@arnon3339/thtex?logo=npm)](https://www.npmjs.com/package/@arnon3339/thtex)

**[Open the live React/PWA demo](https://thtex.pages.dev/)** to compile
XeLaTeX documents directly in your browser.

Compile XeLaTeX documents to PDF in the browser. XeTeX, BibTeX, and `xdvipdfmx` run in
an isolated Web Worker, so compilation does not block the React/UI thread.

The package provides:

- a typed, framework-independent browser API;
- configurable one-to-five-pass XeTeX compilation;
- optional classic BibTeX execution with standard `.bst` styles;
- **additional files** — inject fonts, images, style files, and other resources
  into the compiler's virtual filesystem at compile time;
- automatic preservation of `.aux`, `.toc`, `.lof`, `.lot`, `.out`, and other
  generated files between passes;
- serialized calls within one compiler instance;
- isolated filesystems between browser tabs and worker instances;
- a CLI that installs the worker, WASM engines, fonts, and TeX runtime into an
  application's public directory.

## Requirements

- A modern browser with WebAssembly, ES modules, and Web Workers.
- Node.js 20 or newer for installing/building assets.
- A web server. WASM compilation will not work through a `file://` URL.

## Quick start

Install from npm:

```bash
npm install @arnon3339/thtex
# or: pnpm add @arnon3339/thtex
# or: yarn add @arnon3339/thtex
```

Install and verify the browser runtime in your public directory:

```bash
npx @arnon3339/thtex --to public/xelatex
```

The command works with npm, pnpm, and Yarn. The legacy command remains
available:

```bash
pnpm exec thtex-assets --to public/xelatex
```

Both commands copy and verify the worker, engines, ICU data, fonts, and TeX
runtime. They overwrite package-owned files but do not delete unrelated files.
Run the command again whenever the installed package version changes. To check
an existing installation without changing it:

```bash
npx @arnon3339/thtex --check --to public/xelatex
```

For a Vite application, automate this in `package.json`:

```json
{
  "scripts": {
    "xelatex:assets": "thtex --to public/xelatex",
    "predev": "pnpm xelatex:assets",
    "prebuild": "pnpm xelatex:assets",
    "dev": "vite",
    "build": "vite build"
  }
}
```

## Basic usage

```ts
import { XeLaTeXCompiler } from "@arnon3339/thtex";

const compiler = new XeLaTeXCompiler({
  assetBaseUrl: "/xelatex/",
  onStatus({ message }) {
    console.log(message);
  },
  onLog({ stream, message }) {
    console[stream === "stderr" ? "error" : "log"](message);
  },
});

await compiler.ready;

const source = String.raw`\RequirePackage[OT1]{fontenc}
\documentclass{article}
\begin{document}
\section{WebAssembly}
Hello from XeLaTeX.
\end{document}`;

const result = await compiler.compile(source);
const pdfBlob = new Blob([result.pdf], { type: "application/pdf" });
const pdfUrl = URL.createObjectURL(pdfBlob);

document.querySelector("iframe")!.src = pdfUrl;

// When the page/component is destroyed:
compiler.dispose();
URL.revokeObjectURL(pdfUrl);
```

If the application is deployed below a URL prefix, include that prefix in
`assetBaseUrl`. In Vite this can be derived from `import.meta.env.BASE_URL`:

```ts
const compiler = new XeLaTeXCompiler({
  assetBaseUrl: `${import.meta.env.BASE_URL}xelatex/`,
});
```

`compile()` resolves with:

```ts
type XeLaTeXCompileResult = {
  pdf: ArrayBuffer;
  log: string;
  passes: number;
  bibtexRan: boolean;
};
```

## BibTeX bibliographies

Classic BibTeX is optional and disabled by default. Add the `.bib` database
through `additionalFiles` and pass `bibtex: true`. The worker runs XeTeX,
BibTeX, the required follow-up XeTeX pass, and finally `xdvipdfmx`. Standard
styles such as `plain`, `abbrv`, `alpha`, and `unsrt` are included.

```ts
const bibliography = new TextEncoder().encode(String.raw`
@book{knuth1984,
  author = {Donald E. Knuth},
  title = {The TeXbook},
  year = {1984},
  publisher = {Addison-Wesley}
}`);

const source = String.raw`\documentclass{article}
\begin{document}
See \cite{knuth1984}.
\bibliographystyle{plain}
\bibliography{references}
\end{document}`;

const result = await compiler.compile(source, {
  bibtex: true,
  additionalFiles: [{ path: "references.bib", data: bibliography }],
});

console.log(result.bibtexRan); // true
```

The available modes are:

| Value | Behavior |
| --- | --- |
| `false` or omitted | Do not run BibTeX. This is the default. |
| `true` | Run BibTeX and report an error if the first XeTeX pass did not create classic bibliography directives. |
| `"auto"` | Inspect the first `.aux` file and run BibTeX only when bibliography data and style directives are present. |

When BibTeX runs, the worker guarantees at least two XeTeX passes regardless
of the requested `passes` value. Use three passes when citations and other
cross-references require another stabilization pass:

```ts
await compiler.compile(source, {
  passes: 3,
  bibtex: true,
  additionalFiles: [{ path: "references.bib", data: bibliography }],
});
```

BibLaTeX/Biber is not supported by this runtime.

## Additional files (fonts, images, and resources)

Use `additionalFiles` to inject any file into the compiler's virtual
filesystem before compilation. The files are available to both XeTeX and
`xdvipdfmx`, so they work for fonts, images, `.sty` files, `.bib` databases,
and any other resource the LaTeX source references.

Each entry has a `path` (relative to the working directory) and `data`
(a `Uint8Array` of raw bytes). Paths create parent directories automatically.

### Injecting custom fonts

```ts
// Load a font from your server or from a user upload
const fontResponse = await fetch("/fonts/THSarabun.ttf");
const fontBytes = new Uint8Array(await fontResponse.arrayBuffer());

const source = String.raw`\documentclass{article}
\usepackage{fontspec}
\setmainfont{THSarabun.ttf}[Path=fonts/]
\begin{document}
Hello in Thai Sarabun!
\end{document}`;

const result = await compiler.compile(source, {
  additionalFiles: [
    { path: "fonts/THSarabun.ttf", data: fontBytes },
  ],
});
```

### Including images

```ts
const logoResponse = await fetch("/assets/logo.png");
const logoBytes = new Uint8Array(await logoResponse.arrayBuffer());

const source = String.raw`\documentclass{article}
\usepackage{graphicx}
\begin{document}
\includegraphics[width=3cm]{images/logo.png}
\end{document}`;

const result = await compiler.compile(source, {
  additionalFiles: [
    { path: "images/logo.png", data: logoBytes },
  ],
});
```

### Mixing fonts, images, and styles

```ts
const result = await compiler.compile(source, {
  passes: 2,
  additionalFiles: [
    { path: "fonts/MyFont.ttf",       data: fontBytes },
    { path: "fonts/MyFont-Bold.ttf",  data: fontBoldBytes },
    { path: "images/header.png",      data: headerImageBytes },
    { path: "custom.sty",             data: customStyleBytes },
  ],
});
```

### Type reference

```ts
import type { XeLaTeXAdditionalFile } from "@arnon3339/thtex";

const files: XeLaTeXAdditionalFile[] = [
  { path: "fonts/MyFont.ttf", data: fontBytes },
];
```

The compiler preserves the `Uint8Array` buffers supplied by your application,
so the same font or image data can be reused for multiple compilations:

```ts
await compiler.compile(firstSource, { additionalFiles: sharedFiles });
await compiler.compile(secondSource, { additionalFiles: sharedFiles });
```

Paths must be relative to `/work`; absolute paths and `..` traversal are
rejected with a clear error before work is sent to the compiler.

## React example

Create one compiler for the component lifetime and dispose it during cleanup:

```tsx
import { useEffect, useRef, useState } from "react";
import { XeLaTeXCompiler } from "@arnon3339/thtex";

export function PdfCompiler({ source }: { source: string }) {
  const compilerRef = useRef<XeLaTeXCompiler | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string>();

  useEffect(() => {
    const compiler = new XeLaTeXCompiler({
      assetBaseUrl: "/xelatex/",
    });

    compilerRef.current = compiler;
    return () => {
      compiler.dispose();

      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, []);

  async function compile() {
    const result = await compilerRef.current!.compile(source);
    const nextUrl = URL.createObjectURL(
      new Blob([result.pdf], { type: "application/pdf" }),
    );

    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
    }

    pdfUrlRef.current = nextUrl;
    setPdfUrl(nextUrl);
  }

  return (
    <>
      <button onClick={() => void compile()}>Compile PDF</button>
      {pdfUrl && <iframe title="Generated PDF" src={pdfUrl} />}
    </>
  );
}
```

The application in this repository is a complete working React example and
also exposes a pass-count selector.

### React example with custom fonts

This pattern pre-loads font files once and injects them on each compile:

```tsx
import { useEffect, useRef, useState } from "react";
import { XeLaTeXCompiler } from "@arnon3339/thtex";
import type { XeLaTeXAdditionalFile } from "@arnon3339/thtex";

export function PdfCompiler({ source }: { source: string }) {
  const compilerRef = useRef<XeLaTeXCompiler | null>(null);
  const pdfUrlRef = useRef<string | null>(null);
  const fontsRef = useRef<XeLaTeXAdditionalFile[]>([]);
  const [pdfUrl, setPdfUrl] = useState<string>();

  useEffect(() => {
    const compiler = new XeLaTeXCompiler({ assetBaseUrl: "/xelatex/" });
    compilerRef.current = compiler;

    // Pre-load fonts once
    Promise.all(
      ["THSarabun.ttf", "THSarabun-Bold.ttf"].map(async (name) => {
        const res = await fetch(`/fonts/${name}`);
        const buf = await res.arrayBuffer();
        return { path: `fonts/${name}`, data: new Uint8Array(buf) };
      }),
    ).then((fonts) => {
      fontsRef.current = fonts;
    });

    return () => {
      compiler.dispose();
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  async function compile() {
    const result = await compilerRef.current!.compile(source, {
      additionalFiles: fontsRef.current,
    });

    const nextUrl = URL.createObjectURL(
      new Blob([result.pdf], { type: "application/pdf" }),
    );

    if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    pdfUrlRef.current = nextUrl;
    setPdfUrl(nextUrl);
  }

  return (
    <>
      <button onClick={() => void compile()}>Compile PDF</button>
      {pdfUrl && <iframe title="Generated PDF" src={pdfUrl} />}
    </>
  );
}
```

## Lifecycle and memory management

Creating a compiler starts its Web Worker and begins loading the WASM engines
and TeX runtime. For applications where PDF compilation is optional, create it
lazily after the user first requests compilation:

```ts
let compiler: XeLaTeXCompiler | undefined;

async function getCompiler() {
  compiler ??= new XeLaTeXCompiler({
    assetBaseUrl: "/xelatex/",
  });

  await compiler.ready;
  return compiler;
}

async function compilePdf(source: string) {
  const activeCompiler = await getCompiler();
  return activeCompiler.compile(source);
}

function closeCompiler() {
  compiler?.dispose();
  compiler = undefined;
}
```

Reuse one compiler while its editor or feature is active. This avoids loading
the large runtime again for every PDF, and calls on that instance are safely
queued. Temporary XeTeX modules, virtual filesystems, XDV data, and pass data
become eligible for browser garbage collection after each job. The worker
keeps the shared runtime assets in memory to make the next job faster; browser
garbage collection timing is not controlled by the package.

The returned PDF buffer belongs to the application. If it is converted into a
Blob URL, revoke the previous URL when replacing the preview and revoke the
last URL when the component or page is destroyed:

```ts
let pdfUrl: string | undefined;

function showPdf(pdf: ArrayBuffer, iframe: HTMLIFrameElement) {
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);

  pdfUrl = URL.createObjectURL(
    new Blob([pdf], { type: "application/pdf" }),
  );
  iframe.src = pdfUrl;
}

function closePdfPreview() {
  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
  pdfUrl = undefined;
}
```

Call `compiler.dispose()` when the owning React component unmounts, when the
user closes the PDF feature, or when the application no longer expects more
compilations. Disposal terminates the worker and releases its WASM/runtime
memory. A disposed compiler cannot be reused; create a new instance if the
feature is opened again. Do not dispose it while a wanted compilation is
running because the active job will be rejected.

## Multiple XeTeX passes

The default is one pass, which is fastest for simple documents. References,
tables of contents, `longtable`, page labels, and complex layouts often write
measurements or labels during the first pass and consume them during a second
pass, so request two passes for those documents.

```ts
// Use the compiler default (one pass).
await compiler.compile(source);

// Resolve references and layout calculations with two passes.
await compiler.compile(source, { passes: 2 });

// Or make two passes the default for this compiler instance.
const multiPassCompiler = new XeLaTeXCompiler({
  assetBaseUrl: "/xelatex/",
  defaultPasses: 2,
});

// Documents whose references stabilize later can use three passes.
await compiler.compile(source, { passes: 3 });
```

Between passes, the worker creates a fresh Emscripten module and copies the
generated working files into it. Fresh modules are required because the
engines are linked with `EXIT_RUNTIME=1`. Only the final pass's XDV is sent to
`xdvipdfmx`.

Valid pass counts are integers from 1 through 5. Two passes are a good general
default. Additional passes increase CPU time and peak memory pressure.

Multiple XeTeX passes do not implicitly enable external programs. BibTeX runs
only when selected with the separate `bibtex` option. Biber, MakeIndex, and
MakeGlossaries are not included and require separate WASM engines and pipeline
stages.

## Compilation queue and isolation

Calls made through one `XeLaTeXCompiler` instance are queued and run in order:

```ts
const first = compiler.compile(firstSource);
const second = compiler.compile(secondSource);
const [firstPdf, secondPdf] = await Promise.all([first, second]);
```

They do not overwrite each other. Separate tabs create separate workers and
separate in-memory filesystems. To compile truly in parallel in one tab,
create multiple compiler instances; be aware that every active engine has a
large WebAssembly memory allocation.

## API

### `new XeLaTeXCompiler(options?)`

| Option | Default | Description |
| --- | --- | --- |
| `assetBaseUrl` | `/xelatex/` | Public directory created by the asset CLI. |
| `workerUrl` | `<assetBaseUrl>/xelatex.worker.js` | Explicit worker override. Runtime assets must remain beside it. |
| `defaultPasses` | `1` | Default XeTeX pass count, from 1 through 5. |
| `onStatus` | — | Receives initialization/compilation status and download progress. |
| `onLog` | — | Receives streamed stdout/stderr messages. |

### `compiler.ready`

A promise resolving after the engines, runtime manifest, and build-time
generated `xelatex.fmt` have loaded:

```ts
const { runtimeFileCount, runtimeBytes } = await compiler.ready;
```

During the initial download, `onStatus` receives `loadedBytes`, `totalBytes`,
`loadedFiles`, and `totalFiles`. This makes it straightforward to display a
real progress bar instead of an indefinite loading message.

### `compiler.compile(source, options?)`

Queues a compilation and returns `Promise<XeLaTeXCompileResult>`.

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `passes` | `number` | Compiler default | XeTeX pass count (1–5). |
| `bibtex` | `boolean \| "auto"` | `false` | Whether to run classic BibTeX after the first XeTeX pass. |
| `additionalFiles` | `XeLaTeXAdditionalFile[]` | `[]` | Files to mount in the VFS before compilation — fonts, images, styles, etc. |
| `onLog` | `(event) => void` | — | Per-job log callback. |
| `onStatus` | `(event) => void` | — | Per-job status callback. |

### `compiler.dispose()`

Terminates the worker. Call it when the owning page or component is destroyed.

### Errors

Compilation failures reject with `XeLaTeXCompileError`, which includes the
complete compiler log:

```ts
import { XeLaTeXCompileError } from "@arnon3339/thtex";

try {
  await compiler.compile(source);
} catch (error) {
  if (error instanceof XeLaTeXCompileError) {
    console.error(error.message, error.log);
  }
}
```

## Installed browser assets

The asset CLI creates this structure:

```text
public/xelatex/
├── xelatex.worker.js
├── runtime-manifest.json
├── engine/
│   ├── xetex.mjs
│   ├── xetex.wasm
│   ├── bibtex.mjs
│   ├── bibtex.wasm
│   ├── xdvipdfmx.mjs
│   └── xdvipdfmx.wasm
├── texmf/
├── fonts/
├── fontconfig/
└── icu/                 # present when ICU runtime files are required
```

The focused runtime includes configuration and dependencies for LaTeX,
`fontspec`, `expl3`, `graphicx`, `xcolor`, `geometry`, `amsmath`, `hyperref`,
and `longtable`. The exact files are recorded in `runtime-manifest.json`.

If you add files under `public/xelatex/texmf`, `fonts`, `fontconfig`, or `icu`,
regenerate the application's manifest:

```bash
pnpm exec thtex-manifest --root public/xelatex
```

## Building this package

The XeTeX, BibTeX, and `xdvipdfmx` browser engines are sourced from the sibling
`xelatex-artifacts` project. A build synchronizes the six browser artifacts,
generates a format with that exact XeTeX WASM binary, and creates the runtime
manifest before compiling the TypeScript package.

The default artifact directory is `../xelatex-artifacts`. Override it when
needed with `XELATEX_ARTIFACTS_DIR` or run the synchronization command with
`--from`:

```bash
pnpm xelatex:sync-artifacts --from /path/to/xelatex-artifacts
```

The focused TeX runtime synchronizes its 11/12 pt class support from the
installed TeX Live tree discovered by `kpsewhich`. Set `XELATEX_TEXMF_DIST`
to override that source directory.

```bash
pnpm install
pnpm build          # TypeScript/worker build using the bundled runtime
pnpm build:runtime  # Maintainers: resync artifacts + TeX, then build
pnpm check          # Full runtime, lint, PDF, and package validation
```

`pnpm build` generates the typed ESM library and standalone module worker in
`dist/`. Commit `dist/` before pushing a tag or commit intended for GitHub
installation.

Run the repository's React demo with:

```bash
pnpm dev
```

A standalone Vite + React PWA is available in
[`examples/react`](./examples/react). It includes a source editor, PDF preview,
offline service worker, Cloudflare Pages headers, SPA redirects, and automatic
Cloudflare-safe runtime chunking.

## Runtime size and hosting

XeTeX, ICU, fonts, and the focused TeX tree are substantial browser assets.
The initial installation is roughly 75 MiB and should be served with long-lived
cache headers or a service worker. The largest individual asset is ICU data at
about 31.9 MB.

For a host with a per-file limit, ask the asset CLI to split oversized runtime
files. For example, Cloudflare Pages has a 25 MiB asset limit:

```bash
thtex --to public/xelatex --max-file-size 24MiB
```

The destination manifest records the chunks, and the worker reassembles the
original runtime file in memory. Engine WASM files are not splittable, so the
CLI reports an error if the selected limit is lower than an engine asset. The
runtime is downloaded once per browser cache and reused by one compiler
instance for subsequent jobs.

## License

The TypeScript/JavaScript package code is MIT licensed. Bundled XeTeX,
`xdvipdfmx`, TeX packages, and fonts retain their respective upstream
licenses; see [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md).
