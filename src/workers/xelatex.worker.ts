/// <reference lib="webworker" />

type AdditionalFile = {
  path: string;
  data: Uint8Array;
};

type CompileRequest = {
  type: "compile";
  requestId: string;
  source: string;
  passes: number;
  additionalFiles?: AdditionalFile[];
};

type RuntimeManifest = {
  version: 1;
  files: Array<{
    path: string;
    size: number;
    chunks?: Array<{
      path: string;
      size: number;
    }>;
  }>;
};

type EmscriptenFileSystem = {
  analyzePath(path: string): { exists: boolean };
  chdir(path: string): void;
  isDir(mode: number): boolean;
  mkdirTree(path: string): void;
  readFile(path: string, options?: { encoding?: "binary" }): Uint8Array;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  writeFile(path: string, data: string | Uint8Array): void;
};

type EmscriptenModule = {
  ENV: Record<string, string>;
  FS: EmscriptenFileSystem;
  callMain(arguments_: string[]): number;
};

type ModuleOptions = {
  noInitialRun: true;
  thisProgram: string;
  locateFile(file: string): string;
  print(message: string): void;
  printErr(message: string): void;
  preRun: Array<(module: EmscriptenModule) => void>;
};

type ModuleFactory = (
  options: ModuleOptions,
) => Promise<EmscriptenModule>;

type RuntimeFile = {
  path: string;
  bytes: Uint8Array;
};

type LoadedRuntime = {
  files: RuntimeFile[];
  totalBytes: number;
};

const worker = self as DedicatedWorkerGlobalScope;
const runtimeBaseUrl = new URL("./", self.location.href);
const engineBaseUrl = new URL("engine/", runtimeBaseUrl);
const manifestUrl = new URL(
  "runtime-manifest.json",
  runtimeBaseUrl,
);

const texEnvironment: Record<string, string> = {
  HOME: "/work",
  TMPDIR: "/work",
  TEXMFCNF: "/texmf/web2c",
  TEXFORMATS: "/texmf/web2c",
  TEXINPUTS: ".:/work//:/texmf/tex//",
  TEXMFVAR: "/work/texmf-var",
  TEXMFCONFIG: "/work/texmf-config",
  TEXMFHOME: "/work/texmf-home",
  TFMFONTS: ".:/texmf/fonts/tfm//",
  VFFONTS: ".:/texmf/fonts/vf//",
  TEXFONTMAPS: ".:/texmf/fonts/map//",
  DVIPDFMXINPUTS: ".:/texmf/dvipdfmx//:/texmf/tex//",
  ENCFONTS: ".:/texmf/fonts/enc//",
  CMAPFONTS: ".:/texmf/fonts/cmap//",
  OPENTYPEFONTS: ".:/fonts//:/texmf/fonts/opentype//",
  TTFONTS: ".:/fonts//:/texmf/fonts/truetype//",
  T1FONTS: ".:/texmf/fonts/type1//",
  ICU_DATA: "/icu",
  FONTCONFIG_FILE: "/fontconfig/fonts.conf",
  FONTCONFIG_PATH: "/fontconfig",
  MKTEXTFM: "0",
  MKTEXPK: "0",
  MKTEXMF: "0",
  MKTEXFMT: "0",
};

let compiling = false;

function post(message: object, transfer: Transferable[] = []) {
  worker.postMessage(message, transfer);
}

function getRuntimeUrl(path: string) {
  return new URL(
    path
      .split("/")
      .map((part) => encodeURIComponent(part))
      .join("/"),
    runtimeBaseUrl,
  ).href;
}

async function importFactory(file: string): Promise<ModuleFactory> {
  const moduleUrl = new URL(file, engineBaseUrl).href;
  const imported = (await import(
    /* @vite-ignore */ moduleUrl
  )) as { default: ModuleFactory };

  return imported.default;
}

async function loadRuntimeFiles(): Promise<LoadedRuntime> {
  const response = await fetch(manifestUrl);

  if (!response.ok) {
    throw new Error(
      `Runtime manifest could not be loaded (${response.status}). Run pnpm xelatex:manifest after adding the texmf, fonts, and ICU assets.`,
    );
  }

  const manifest = (await response.json()) as RuntimeManifest;

  if (manifest.version !== 1 || !Array.isArray(manifest.files)) {
    throw new Error("The XeLaTeX runtime manifest is invalid.");
  }

  const totalBytes = manifest.files.reduce((sum, file) => sum + file.size, 0);
  let loadedBytes = 0;
  let loadedFiles = 0;
  let lastReportedPercent = -5;

  const reportProgress = () => {
    const percent =
      totalBytes === 0 ? 100 : Math.floor((loadedBytes / totalBytes) * 100);

    if (percent !== 100 && percent < lastReportedPercent + 5) return;
    lastReportedPercent = percent;
    post({
      type: "initialization-status",
      message: `Loading XeLaTeX runtime… ${percent}%`,
      phase: "loading-runtime",
      loadedBytes,
      loadedFiles,
      totalBytes,
      totalFiles: manifest.files.length,
    });
  };

  reportProgress();
  const fetchAsset = async (path: string, expectedSize: number) => {
    const assetResponse = await fetch(getRuntimeUrl(path));

    if (!assetResponse.ok) {
      throw new Error(
        `Runtime asset ${path} could not be loaded (${assetResponse.status}).`,
      );
    }

    const bytes = new Uint8Array(await assetResponse.arrayBuffer());

    if (bytes.byteLength !== expectedSize) {
      throw new Error(
        `Runtime asset ${path} has ${bytes.byteLength} bytes; the manifest expects ${expectedSize}.`,
      );
    }

    return bytes;
  };

  const files = await Promise.all(
    manifest.files.map(async ({ path, size, chunks }) => {
      let bytes: Uint8Array;

      if (chunks?.length) {
        const chunkBytes = await Promise.all(
          chunks.map((chunk) => fetchAsset(chunk.path, chunk.size)),
        );
        bytes = new Uint8Array(size);
        let offset = 0;

        for (const chunk of chunkBytes) {
          bytes.set(chunk, offset);
          offset += chunk.byteLength;
        }

        if (offset !== size) {
          throw new Error(
            `Runtime chunks for ${path} have ${offset} bytes; the manifest expects ${size}.`,
          );
        }
      } else {
        bytes = await fetchAsset(path, size);
      }

      loadedBytes += bytes.byteLength;
      loadedFiles += 1;
      reportProgress();

      return {
        path: `/${path}`,
        bytes,
      };
    }),
  );

  return { files, totalBytes };
}

post({
  type: "initialization-status",
  message: "Initializing WebAssembly XeTeX engines…",
  phase: "initializing",
});

const factoriesPromise = Promise.all([
  importFactory("xetex.mjs"),
  importFactory("xdvipdfmx.mjs"),
]);

const runtimeFilesPromise = loadRuntimeFiles();

function installRuntime(
  module: EmscriptenModule,
  runtimeFiles: RuntimeFile[],
) {
  const { FS } = module;

  for (const directory of [
    "/work",
    "/work/texmf-var",
    "/work/texmf-config",
    "/work/texmf-home",
    "/work/fontconfig-cache",
  ]) {
    FS.mkdirTree(directory);
  }

  for (const file of runtimeFiles) {
    const separator = file.path.lastIndexOf("/");
    FS.mkdirTree(file.path.slice(0, separator));
    FS.writeFile(file.path, file.bytes);
  }

  Object.assign(module.ENV, texEnvironment);
  FS.chdir("/work");
}

function createModuleOptions(
  program: string,
  runtimeFiles: RuntimeFile[],
  requestId: string | null,
  logLines: string[],
): ModuleOptions {
  const writeLog = (stream: "stdout" | "stderr", value: unknown) => {
    const message = String(value);
    logLines.push(stream === "stderr" ? `[stderr] ${message}` : message);
    if (requestId) {
      post({ type: "log", requestId, stream, message });
    }
  };

  return {
    noInitialRun: true,
    thisProgram: program,
    locateFile(file) {
      return new URL(file, engineBaseUrl).href;
    },
    print(message) {
      writeLog("stdout", message);
    },
    printErr(message) {
      writeLog("stderr", message);
    },
    preRun: [
      (module) => {
        installRuntime(module, runtimeFiles);
        module.FS.writeFile(`/work/${program}`, new Uint8Array());
      },
    ],
  };
}

function requireModuleApi(module: EmscriptenModule, program: string) {
  const missing = [
    !module.FS && "FS",
    typeof module.callMain !== "function" && "callMain",
    !module.ENV && "ENV",
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(
      `${program} is missing Emscripten runtime exports: ${missing.join(", ")}. Relink it with FS, callMain, and ENV in EXPORTED_RUNTIME_METHODS.`,
    );
  }
}

function readRequiredFile(module: EmscriptenModule, path: string) {
  if (!module.FS.analyzePath(path).exists) {
    throw new Error(`Expected output ${path} was not generated.`);
  }

  return module.FS.readFile(path, { encoding: "binary" });
}

function writeFiles(FS: EmscriptenFileSystem, files: RuntimeFile[]) {
  for (const file of files) {
    const separator = file.path.lastIndexOf("/");
    FS.mkdirTree(file.path.slice(0, separator));
    FS.writeFile(file.path, file.bytes);
  }
}

function snapshotPassFiles(FS: EmscriptenFileSystem) {
  const files: RuntimeFile[] = [];
  const ignoredWorkEntries = new Set([
    "fontconfig-cache",
    "main.log",
    "main.pdf",
    "main.tex",
    "main.xdv",
    "texmf-config",
    "texmf-home",
    "texmf-var",
    "xelatex",
  ]);

  function visit(directory: string) {
    for (const name of FS.readdir(directory)) {
      if (name === "." || name === "..") {
        continue;
      }

      if (directory === "/work" && ignoredWorkEntries.has(name)) {
        continue;
      }

      const path = `${directory}/${name}`;
      const metadata = FS.stat(path);

      if (FS.isDir(metadata.mode)) {
        visit(path);
      } else {
        files.push({
          path,
          bytes: new Uint8Array(FS.readFile(path, { encoding: "binary" })),
        });
      }
    }
  }

  visit("/work");
  return files;
}

function addLogMarker(
  requestId: string,
  logLines: string[],
  message: string,
) {
  logLines.push(message);
  post({
    type: "log",
    requestId,
    stream: "stdout",
    message,
  });
}

async function runXeTeXPass(
  createXeTeXModule: ModuleFactory,
  runtimeFiles: RuntimeFile[],
  requestId: string,
  logLines: string[],
  source: string,
  pass: number,
  passCount: number,
  previousPassFiles: RuntimeFile[],
  additionalFiles: AdditionalFile[],
) {
  post({
    type: "status",
    requestId,
    message: `Running XeTeX pass ${pass} of ${passCount}…`,
    phase: "compiling",
  });
  addLogMarker(
    requestId,
    logLines,
    `\n===== XeTeX pass ${pass} of ${passCount} =====`,
  );

  const xetex = await createXeTeXModule(
    createModuleOptions("xelatex", runtimeFiles, requestId, logLines),
  );
  requireModuleApi(xetex, "XeTeX");
  writeFiles(xetex.FS, previousPassFiles);

  // Mount caller-supplied files (fonts, images, styles, etc.)
  for (const file of additionalFiles) {
    const vfsPath = `/work/${file.path}`;
    const separator = vfsPath.lastIndexOf("/");
    xetex.FS.mkdirTree(vfsPath.slice(0, separator));
    xetex.FS.writeFile(vfsPath, file.data);
  }

  xetex.FS.writeFile("/work/main.tex", source);

  const status = xetex.callMain([
    "-fmt=xelatex",
    "-no-pdf",
    "-interaction=nonstopmode",
    "-halt-on-error",
    "-file-line-error",
    "-output-directory=/work",
    "/work/main.tex",
  ]);

  if (status !== 0) {
    throw new Error(`XeTeX pass ${pass} exited with status ${status}.`);
  }

  return {
    xdv: new Uint8Array(readRequiredFile(xetex, "/work/main.xdv")),
    nextPassFiles: snapshotPassFiles(xetex.FS),
  };
}

async function compile(request: CompileRequest) {
  const { passes: passCount, requestId, source } = request;
  const logLines: string[] = [];

  try {
    post({
      type: "status",
      requestId,
      message: "Loading XeLaTeX runtime…",
      phase: "loading-runtime",
    });

    const [[createXeTeXModule, createXdvipdfmxModule], runtime] =
      await Promise.all([factoriesPromise, runtimeFilesPromise]);
    const runtimeFiles = runtime.files;

    if (!Number.isInteger(passCount) || passCount < 1 || passCount > 5) {
      throw new Error("XeTeX passes must be an integer between 1 and 5.");
    }

    const callerFiles = request.additionalFiles ?? [];

    let previousPassFiles: RuntimeFile[] = [];
    let finalXdv: Uint8Array | null = null;

    for (let pass = 1; pass <= passCount; pass += 1) {
      const result = await runXeTeXPass(
        createXeTeXModule,
        runtimeFiles,
        requestId,
        logLines,
        source,
        pass,
        passCount,
        previousPassFiles,
        callerFiles,
      );

      previousPassFiles = result.nextPassFiles;
      finalXdv = result.xdv;
    }

    if (!finalXdv) {
      throw new Error("XeTeX did not produce an XDV document.");
    }

    post({
      type: "status",
      requestId,
      message: "Converting XDV to PDF…",
      phase: "converting",
    });

    const xdvipdfmx = await createXdvipdfmxModule(
      createModuleOptions("xdvipdfmx", runtimeFiles, requestId, logLines),
    );
    requireModuleApi(xdvipdfmx, "xdvipdfmx");
    xdvipdfmx.FS.writeFile("/work/main.xdv", finalXdv);

    // Mount caller-supplied files so xdvipdfmx can resolve images and fonts.
    for (const file of callerFiles) {
      const vfsPath = `/work/${file.path}`;
      const separator = vfsPath.lastIndexOf("/");
      xdvipdfmx.FS.mkdirTree(vfsPath.slice(0, separator));
      xdvipdfmx.FS.writeFile(vfsPath, file.data);
    }

    const xdvipdfmxStatus = xdvipdfmx.callMain([
      "-o",
      "/work/main.pdf",
      "/work/main.xdv",
    ]);

    if (xdvipdfmxStatus !== 0) {
      throw new Error(`xdvipdfmx exited with status ${xdvipdfmxStatus}.`);
    }

    const pdf = readRequiredFile(xdvipdfmx, "/work/main.pdf");
    const transferablePdf = new Uint8Array(pdf).buffer;

    post(
      {
        type: "success",
        requestId,
        pdf: transferablePdf,
        log: logLines.join("\n"),
        passes: passCount,
      },
      [transferablePdf],
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown compilation error.";

    logLines.push(`[worker] ${message}`);
    post({
      type: "error",
      requestId,
      message,
      log: logLines.join("\n"),
    });
  } finally {
    compiling = false;
  }
}

worker.onmessage = (event: MessageEvent<CompileRequest>) => {
  const request = event.data;

  if (request.type !== "compile") {
    return;
  }

  if (compiling) {
    post({
      type: "error",
      requestId: request.requestId,
      message: "A document is already compiling.",
      log: "",
    });
    return;
  }

  compiling = true;
  void compile(request);
};

Promise.all([factoriesPromise, runtimeFilesPromise])
  .then(([, runtime]) => {
    post({
      type: "ready",
      runtimeBytes: runtime.totalBytes,
      runtimeFileCount: runtime.files.length,
    });
  })
  .catch((error) => {
    post({
      type: "initialization-error",
      message:
        error instanceof Error
          ? error.message
          : "The XeLaTeX worker could not initialize.",
    });
  });

export {};
