export type XeLaTeXLogStream = "stdout" | "stderr";
export type XeLaTeXPhase = "initializing" | "loading-runtime" | "ready" | "compiling" | "bibliography" | "converting";
export type XeLaTeXBibTeXMode = boolean | "auto";
export type XeLaTeXStatusEvent = {
    message: string;
    phase?: XeLaTeXPhase;
    requestId?: string;
    loadedBytes?: number;
    loadedFiles?: number;
    totalBytes?: number;
    totalFiles?: number;
};
export type XeLaTeXLogEvent = {
    message: string;
    requestId: string;
    stream: XeLaTeXLogStream;
};
export type XeLaTeXReadyInfo = {
    runtimeBytes: number;
    runtimeFileCount: number;
};
/**
 * A file to write into the compiler's virtual filesystem before each
 * compilation pass. Use this to inject fonts, images, BibTeX databases,
 * style files, or any other resource the LaTeX source references.
 *
 * The `path` is relative to the working directory (`/work`). For example,
 * `"fonts/MyFont.ttf"` is written to `/work/fonts/MyFont.ttf`, which XeTeX
 * resolves when the template contains `\setmainfont{MyFont.ttf}[Path=fonts/]`.
 */
export type XeLaTeXAdditionalFile = {
    /** VFS path relative to /work (e.g. "fonts/MyFont.ttf", "images/logo.png"). */
    path: string;
    /** Raw file bytes. */
    data: Uint8Array;
};
export type XeLaTeXCompileOptions = {
    /** Number of sequential XeTeX passes. Defaults to the compiler setting. */
    passes?: number;
    /**
     * Run BibTeX between XeTeX passes. Disabled by default. `true` requires
     * classic BibTeX data/style directives, while `"auto"` runs BibTeX only
     * when the first `.aux` file contains those directives.
     */
    bibtex?: XeLaTeXBibTeXMode;
    /**
     * Extra files to mount in the virtual filesystem before each XeTeX pass
     * and before xdvipdfmx. Paths are relative to the working directory.
     *
     * Common uses:
     * - Fonts:  `{ path: "fonts/THSarabun.ttf", data: fontBytes }`
     * - Images: `{ path: "images/logo.png",      data: imageBytes }`
     * - Styles: `{ path: "custom.sty",            data: styBytes }`
     */
    additionalFiles?: XeLaTeXAdditionalFile[];
    onLog?: (event: XeLaTeXLogEvent) => void;
    onStatus?: (event: XeLaTeXStatusEvent) => void;
};
export type XeLaTeXCompileResult = {
    /** Generated PDF bytes. */
    pdf: ArrayBuffer;
    /** Combined output from all XeTeX passes and xdvipdfmx. */
    log: string;
    /** Number of XeTeX passes used for this compilation. */
    passes: number;
    /** Whether BibTeX ran during this compilation. */
    bibtexRan: boolean;
};
export type XeLaTeXCompilerOptions = {
    /**
     * Public URL containing xelatex.worker.js, engine/, texmf/, fonts/, and
     * runtime-manifest.json. Defaults to /xelatex/.
     */
    assetBaseUrl?: string | URL;
    /** Override the worker URL. Runtime assets must remain beside the worker. */
    workerUrl?: string | URL;
    /** Default XeTeX pass count. Defaults to 1. */
    defaultPasses?: number;
    onLog?: (event: XeLaTeXLogEvent) => void;
    onStatus?: (event: XeLaTeXStatusEvent) => void;
};
export type WorkerCompileRequest = {
    type: "compile";
    requestId: string;
    source: string;
    passes: number;
    bibtex: XeLaTeXBibTeXMode;
    additionalFiles?: Array<{
        path: string;
        data: Uint8Array;
    }>;
};
export type XeLaTeXWorkerResponse = ({
    type: "ready";
} & XeLaTeXReadyInfo) | {
    type: "initialization-error";
    message: string;
} | ({
    type: "initialization-status";
} & XeLaTeXStatusEvent) | ({
    type: "status";
} & XeLaTeXStatusEvent & {
    requestId: string;
}) | ({
    type: "log";
} & XeLaTeXLogEvent) | {
    type: "success";
    requestId: string;
    pdf: ArrayBuffer;
    log: string;
    passes: number;
    bibtexRan: boolean;
} | {
    type: "error";
    requestId: string;
    message: string;
    log: string;
};
//# sourceMappingURL=types.d.ts.map