import type {
  WorkerCompileRequest,
  XeLaTeXCompileOptions,
  XeLaTeXCompileResult,
  XeLaTeXCompilerOptions,
  XeLaTeXLogEvent,
  XeLaTeXReadyInfo,
  XeLaTeXStatusEvent,
  XeLaTeXWorkerResponse,
} from "./types.js";

const MIN_PASSES = 1;
const MAX_PASSES = 5;

type PendingCompilation = {
  options: XeLaTeXCompileOptions;
  passes: number;
  reject(error: Error): void;
  requestId: string;
  resolve(result: XeLaTeXCompileResult): void;
};

function validatePasses(value: number) {
  if (!Number.isInteger(value) || value < MIN_PASSES || value > MAX_PASSES) {
    throw new RangeError(
      `XeTeX passes must be an integer between ${MIN_PASSES} and ${MAX_PASSES}.`,
    );
  }

  return value;
}

function resolveUrl(value: string | URL, base: string | URL) {
  return value instanceof URL ? value : new URL(value, base);
}

function createRequestId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `xelatex-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function prepareAdditionalFiles(
  files: XeLaTeXCompileOptions["additionalFiles"],
) {
  return (files ?? []).map((file, index) => {
    const path = file.path.replaceAll("\\", "/");
    const segments = path.split("/");

    if (
      !path ||
      path.startsWith("/") ||
      segments.some(
        (segment) => segment === "" || segment === "." || segment === "..",
      )
    ) {
      throw new TypeError(
        `additionalFiles[${index}].path must be a safe path relative to /work.`,
      );
    }

    if (!(file.data instanceof Uint8Array)) {
      throw new TypeError(
        `additionalFiles[${index}].data must be a Uint8Array.`,
      );
    }

    return {
      path,
      // Transfer a private copy so compile() never detaches caller-owned data.
      data: file.data.slice(),
    };
  });
}

export class XeLaTeXCompileError extends Error {
  readonly log: string;

  constructor(message: string, log = "") {
    super(message);
    this.name = "XeLaTeXCompileError";
    this.log = log;
  }
}

/** Browser client for the packaged XeLaTeX Web Worker runtime. */
export class XeLaTeXCompiler {
  readonly ready: Promise<XeLaTeXReadyInfo>;

  private readonly defaultPasses: number;
  private readonly onLog?: (event: XeLaTeXLogEvent) => void;
  private readonly onStatus?: (event: XeLaTeXStatusEvent) => void;
  private readonly worker: Worker;
  private disposed = false;
  private fatalError: Error | null = null;
  private pending: PendingCompilation | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private rejectReady!: (error: Error) => void;
  private resolveReady!: (info: XeLaTeXReadyInfo) => void;
  private readySettled = false;

  constructor(options: XeLaTeXCompilerOptions = {}) {
    if (typeof Worker === "undefined") {
      throw new Error("XeLaTeXCompiler requires a browser with Web Workers.");
    }

    this.defaultPasses = validatePasses(options.defaultPasses ?? 1);
    this.onLog = options.onLog;
    this.onStatus = options.onStatus;

    const documentBase =
      typeof document === "undefined" ? "http://localhost/" : document.baseURI;
    const assetBaseUrl = resolveUrl(
      options.assetBaseUrl ?? "/xelatex/",
      documentBase,
    );
    const workerUrl = options.workerUrl
      ? resolveUrl(options.workerUrl, documentBase)
      : new URL("xelatex.worker.js", assetBaseUrl);

    this.ready = new Promise<XeLaTeXReadyInfo>((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.worker = new Worker(workerUrl, {
      name: "thtex",
      type: "module",
    });
    this.worker.onmessage = (event: MessageEvent<XeLaTeXWorkerResponse>) => {
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
  compile(
    source: string,
    options: XeLaTeXCompileOptions = {},
  ): Promise<XeLaTeXCompileResult> {
    if (this.disposed) {
      return Promise.reject(new Error("XeLaTeXCompiler has been disposed."));
    }

    if (this.fatalError) {
      return Promise.reject(this.fatalError);
    }

    if (typeof source !== "string" || source.trim().length === 0) {
      return Promise.reject(
        new TypeError("XeLaTeX source must be a non-empty string."),
      );
    }

    let passes: number;
    let additionalFiles: NonNullable<WorkerCompileRequest["additionalFiles"]>;

    try {
      passes = validatePasses(options.passes ?? this.defaultPasses);
      additionalFiles = prepareAdditionalFiles(options.additionalFiles);
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("Invalid compile options."),
      );
    }
    const job = this.queue.then(() =>
      this.runCompilation(source, passes, additionalFiles, options),
    );

    this.queue = job.then(
      () => undefined,
      () => undefined,
    );

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

  private emitLog(event: XeLaTeXLogEvent, options?: XeLaTeXCompileOptions) {
    this.onLog?.(event);
    options?.onLog?.(event);
  }

  private emitStatus(
    event: XeLaTeXStatusEvent,
    options?: XeLaTeXCompileOptions,
  ) {
    this.onStatus?.(event);
    options?.onStatus?.(event);
  }

  private fail(error: Error) {
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

  private handleMessage(message: XeLaTeXWorkerResponse) {
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
      this.emitStatus(
        {
          message: message.message,
          phase: message.phase,
          requestId: message.requestId,
          loadedBytes: message.loadedBytes,
          loadedFiles: message.loadedFiles,
          totalBytes: message.totalBytes,
          totalFiles: message.totalFiles,
        },
        pending.options,
      );
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
      });
    } else {
      pending.reject(new XeLaTeXCompileError(message.message, message.log));
    }
  }

  private async runCompilation(
    source: string,
    passes: number,
    additionalFiles: NonNullable<WorkerCompileRequest["additionalFiles"]>,
    options: XeLaTeXCompileOptions,
  ) {
    await this.ready;

    if (this.disposed) {
      throw new Error("XeLaTeXCompiler has been disposed.");
    }

    if (this.fatalError) {
      throw this.fatalError;
    }

    const requestId = createRequestId();

    return new Promise<XeLaTeXCompileResult>((resolve, reject) => {
      this.pending = {
        options,
        passes,
        reject,
        requestId,
        resolve,
      };

      const request: WorkerCompileRequest = {
        type: "compile",
        passes,
        requestId,
        source,
        additionalFiles,
      };

      // Transfer private copies for zero-copy worker delivery while preserving
      // the caller's original Uint8Arrays for future compilations.
      const transfer: Transferable[] = additionalFiles.map(
        (f) => f.data.buffer,
      );

      this.worker.postMessage(request, transfer);
    });
  }
}
