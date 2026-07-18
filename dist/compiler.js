const MIN_PASSES = 1;
const MAX_PASSES = 5;
function validatePasses(value) {
    if (!Number.isInteger(value) || value < MIN_PASSES || value > MAX_PASSES) {
        throw new RangeError(`XeTeX passes must be an integer between ${MIN_PASSES} and ${MAX_PASSES}.`);
    }
    return value;
}
function validateBibTeX(value) {
    if (value !== true && value !== false && value !== "auto") {
        throw new TypeError('bibtex must be true, false, or "auto".');
    }
    return value;
}
function resolveUrl(value, base) {
    return value instanceof URL ? value : new URL(value, base);
}
function createRequestId() {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
        return crypto.randomUUID();
    }
    return `xelatex-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function prepareAdditionalFiles(files) {
    return (files ?? []).map((file, index) => {
        const path = file.path.replaceAll("\\", "/");
        const segments = path.split("/");
        if (!path ||
            path.startsWith("/") ||
            segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
            throw new TypeError(`additionalFiles[${index}].path must be a safe path relative to /work.`);
        }
        if (!(file.data instanceof Uint8Array)) {
            throw new TypeError(`additionalFiles[${index}].data must be a Uint8Array.`);
        }
        return {
            path,
            // Transfer a private copy so compile() never detaches caller-owned data.
            data: file.data.slice(),
        };
    });
}
export class XeLaTeXCompileError extends Error {
    log;
    constructor(message, log = "") {
        super(message);
        this.name = "XeLaTeXCompileError";
        this.log = log;
    }
}
/** Browser client for the packaged XeLaTeX Web Worker runtime. */
export class XeLaTeXCompiler {
    ready;
    defaultPasses;
    onLog;
    onStatus;
    worker;
    disposed = false;
    fatalError = null;
    pending = null;
    queue = Promise.resolve();
    rejectReady;
    resolveReady;
    readySettled = false;
    constructor(options = {}) {
        if (typeof Worker === "undefined") {
            throw new Error("XeLaTeXCompiler requires a browser with Web Workers.");
        }
        this.defaultPasses = validatePasses(options.defaultPasses ?? 1);
        this.onLog = options.onLog;
        this.onStatus = options.onStatus;
        const documentBase = typeof document === "undefined" ? "http://localhost/" : document.baseURI;
        const assetBaseUrl = resolveUrl(options.assetBaseUrl ?? "/xelatex/", documentBase);
        const workerUrl = options.workerUrl
            ? resolveUrl(options.workerUrl, documentBase)
            : new URL("xelatex.worker.js", assetBaseUrl);
        this.ready = new Promise((resolve, reject) => {
            this.resolveReady = resolve;
            this.rejectReady = reject;
        });
        this.worker = new Worker(workerUrl, {
            name: "thtex",
            type: "module",
        });
        this.worker.onmessage = (event) => {
            this.handleMessage(event.data);
        };
        this.worker.onerror = (event) => {
            this.fail(new Error(`XeLaTeX worker error: ${event.message}`));
        };
        this.worker.onmessageerror = () => {
            this.fail(new Error("XeLaTeX worker returned an unreadable message."));
        };
    }
    /**
     * Compile a document. Calls are queued, so one compiler instance never runs
     * overlapping jobs in the same worker.
     */
    compile(source, options = {}) {
        if (this.disposed) {
            return Promise.reject(new Error("XeLaTeXCompiler has been disposed."));
        }
        if (this.fatalError) {
            return Promise.reject(this.fatalError);
        }
        if (typeof source !== "string" || source.trim().length === 0) {
            return Promise.reject(new TypeError("XeLaTeX source must be a non-empty string."));
        }
        let bibtex;
        let passes;
        let additionalFiles;
        try {
            bibtex = validateBibTeX(options.bibtex ?? false);
            passes = validatePasses(options.passes ?? this.defaultPasses);
            additionalFiles = prepareAdditionalFiles(options.additionalFiles);
        }
        catch (error) {
            return Promise.reject(error instanceof Error ? error : new Error("Invalid compile options."));
        }
        const job = this.queue.then(() => this.runCompilation(source, passes, bibtex, additionalFiles, options));
        this.queue = job.then(() => undefined, () => undefined);
        return job;
    }
    /** Terminate the worker and reject the active compilation, if any. */
    dispose() {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.worker.terminate();
        const error = new Error("XeLaTeXCompiler was disposed.");
        if (!this.readySettled) {
            this.readySettled = true;
            this.rejectReady(error);
        }
        if (this.pending) {
            this.pending.reject(error);
            this.pending = null;
        }
    }
    emitLog(event, options) {
        this.onLog?.(event);
        options?.onLog?.(event);
    }
    emitStatus(event, options) {
        this.onStatus?.(event);
        options?.onStatus?.(event);
    }
    fail(error) {
        this.fatalError = error;
        if (!this.readySettled) {
            this.readySettled = true;
            this.rejectReady(error);
        }
        if (this.pending) {
            this.pending.reject(error);
            this.pending = null;
        }
    }
    handleMessage(message) {
        if (message.type === "initialization-status") {
            this.emitStatus({
                message: message.message,
                phase: message.phase,
                loadedBytes: message.loadedBytes,
                loadedFiles: message.loadedFiles,
                totalBytes: message.totalBytes,
                totalFiles: message.totalFiles,
            });
            return;
        }
        if (message.type === "initialization-error") {
            this.fail(new Error(message.message));
            return;
        }
        if (message.type === "ready") {
            if (!this.readySettled) {
                this.readySettled = true;
                this.resolveReady({
                    runtimeBytes: message.runtimeBytes,
                    runtimeFileCount: message.runtimeFileCount,
                });
            }
            this.emitStatus({
                message: `Ready · ${message.runtimeFileCount} runtime files loaded`,
                phase: "ready",
                loadedBytes: message.runtimeBytes,
                loadedFiles: message.runtimeFileCount,
                totalBytes: message.runtimeBytes,
                totalFiles: message.runtimeFileCount,
            });
            return;
        }
        const pending = this.pending;
        if (!pending || message.requestId !== pending.requestId) {
            return;
        }
        if (message.type === "status") {
            this.emitStatus({
                message: message.message,
                phase: message.phase,
                requestId: message.requestId,
                loadedBytes: message.loadedBytes,
                loadedFiles: message.loadedFiles,
                totalBytes: message.totalBytes,
                totalFiles: message.totalFiles,
            }, pending.options);
            return;
        }
        if (message.type === "log") {
            this.emitLog(message, pending.options);
            return;
        }
        this.pending = null;
        if (message.type === "success") {
            pending.resolve({
                pdf: message.pdf,
                log: message.log,
                passes: message.passes,
                bibtexRan: message.bibtexRan,
            });
        }
        else {
            pending.reject(new XeLaTeXCompileError(message.message, message.log));
        }
    }
    async runCompilation(source, passes, bibtex, additionalFiles, options) {
        await this.ready;
        if (this.disposed) {
            throw new Error("XeLaTeXCompiler has been disposed.");
        }
        if (this.fatalError) {
            throw this.fatalError;
        }
        const requestId = createRequestId();
        return new Promise((resolve, reject) => {
            this.pending = {
                options,
                passes,
                reject,
                requestId,
                resolve,
            };
            const request = {
                type: "compile",
                bibtex,
                passes,
                requestId,
                source,
                additionalFiles,
            };
            // Transfer private copies for zero-copy worker delivery while preserving
            // the caller's original Uint8Arrays for future compilations.
            const transfer = additionalFiles.map((f) => f.data.buffer);
            this.worker.postMessage(request, transfer);
        });
    }
}
//# sourceMappingURL=compiler.js.map