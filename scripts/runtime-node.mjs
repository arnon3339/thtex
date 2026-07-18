import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
export const runtimeRoot = path.join(packageRoot, "public", "xelatex");
export const engineRoot = path.join(runtimeRoot, "engine");
export const formatPath = path.join(
  runtimeRoot,
  "texmf",
  "web2c",
  "xelatex.fmt",
);

const assetDirectories = ["texmf", "fonts", "icu", "fontconfig"];
const workingDirectories = [
  "/work",
  "/work/texmf-var",
  "/work/texmf-config",
  "/work/texmf-home",
  "/work/fontconfig-cache",
];

const texEnvironment = {
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

async function collectFiles(directory, prefix, includeFormat) {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const files = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".DS_Store") continue;

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(
        ...(await collectFiles(absolutePath, relativePath, includeFormat)),
      );
      continue;
    }

    if (
      !entry.isFile() ||
      (!includeFormat && relativePath === "texmf/web2c/xelatex.fmt")
    ) {
      continue;
    }

    const metadata = await stat(absolutePath);
    if (metadata.size === 0) continue;

    files.push({
      path: `/${relativePath}`,
      bytes: new Uint8Array(await readFile(absolutePath)),
    });
  }

  return files;
}

export async function loadRuntimeFiles({ includeFormat = true } = {}) {
  const files = [];

  for (const directory of assetDirectories) {
    files.push(
      ...(await collectFiles(
        path.join(runtimeRoot, directory),
        directory,
        includeFormat,
      )),
    );
  }

  return files;
}

function installRuntime(module, runtimeFiles, program) {
  for (const directory of workingDirectories) {
    module.FS.mkdirTree(directory);
  }

  for (const file of runtimeFiles) {
    const separator = file.path.lastIndexOf("/");
    module.FS.mkdirTree(file.path.slice(0, separator));
    module.FS.writeFile(file.path, file.bytes);
  }

  Object.assign(module.ENV, texEnvironment);
  if (process.env.XELATEX_FC_DEBUG) {
    module.ENV.FC_DEBUG = process.env.XELATEX_FC_DEBUG;
  }
  module.FS.chdir("/work");
  module.FS.writeFile(`/work/${program}`, new Uint8Array());
}

export async function createEngine(program, runtimeFiles, logLines = []) {
  const modulePath = path.join(engineRoot, `${program}.mjs`);
  const wasmPath = path.join(engineRoot, `${program}.wasm`);
  const [{ default: createModule }, wasmBinary] = await Promise.all([
    import(`${pathToFileURL(modulePath).href}?runtime=${Date.now()}`),
    readFile(wasmPath),
  ]);

  return createModule({
    noInitialRun: true,
    thisProgram: program,
    instantiateWasm(imports, successCallback) {
      WebAssembly.instantiate(wasmBinary, imports).then(({ instance }) => {
        successCallback(instance);
      });
      return {};
    },
    locateFile(file) {
      return pathToFileURL(path.join(engineRoot, file)).href;
    },
    print(message) {
      logLines.push(String(message));
    },
    printErr(message) {
      logLines.push(`[stderr] ${message}`);
    },
    preRun: [
      (module) => {
        installRuntime(module, runtimeFiles, program);
      },
    ],
  });
}

export function readRequiredFile(module, filePath) {
  if (!module.FS.analyzePath(filePath).exists) {
    throw new Error(`Expected runtime output was not created: ${filePath}`);
  }

  return new Uint8Array(
    module.FS.readFile(filePath, { encoding: "binary" }),
  );
}
