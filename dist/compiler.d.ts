import type { XeLaTeXCompileOptions, XeLaTeXCompileResult, XeLaTeXCompilerOptions, XeLaTeXReadyInfo } from "./types.js";
export declare class XeLaTeXCompileError extends Error {
    readonly log: string;
    constructor(message: string, log?: string);
}
/** Browser client for the packaged XeLaTeX Web Worker runtime. */
export declare class XeLaTeXCompiler {
    readonly ready: Promise<XeLaTeXReadyInfo>;
    private readonly defaultPasses;
    private readonly onLog?;
    private readonly onStatus?;
    private readonly worker;
    private disposed;
    private fatalError;
    private pending;
    private queue;
    private rejectReady;
    private resolveReady;
    private readySettled;
    constructor(options?: XeLaTeXCompilerOptions);
    /**
     * Compile a document. Calls are queued, so one compiler instance never runs
     * overlapping jobs in the same worker.
     */
    compile(source: string, options?: XeLaTeXCompileOptions): Promise<XeLaTeXCompileResult>;
    /** Terminate the worker and reject the active compilation, if any. */
    dispose(): void;
    private emitLog;
    private emitStatus;
    private fail;
    private handleMessage;
    private runCompilation;
}
//# sourceMappingURL=compiler.d.ts.map