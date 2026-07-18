#!/usr/bin/env node

import { cp, mkdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runtimeSource = path.join(packageRoot, "public", "xelatex");
const workerSource = path.join(packageRoot, "dist", "xelatex.worker.js");

function printHelp() {
  console.log(`Copy XeLaTeX WASM browser assets into an application.

Usage:
  thtex [--to <directory>]
  thtex --check [--to <directory>]

Options:
  --to <directory>  Destination directory (default: public/xelatex)
  --check           Verify previously copied assets without changing them
  --help             Show this help

The setup command copies and verifies the worker, WASM engines, ICU data,
fonts, and focused TeX runtime. It overwrites package-owned files but does not
delete unrelated files in the destination.`);
}

let destination = "public/xelatex";
let checkOnly = false;

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];

  if (argument === "--help" || argument === "-h") {
    printHelp();
    process.exit(0);
  }

  if (argument === "--check") {
    checkOnly = true;
    continue;
  }

  if (argument === "--to") {
    const value = process.argv[index + 1];

    if (!value) {
      throw new Error("--to requires a directory path.");
    }

    destination = value;
    index += 1;
    continue;
  }

  throw new Error(`Unknown argument: ${argument}`);
}

const destinationPath = path.resolve(process.cwd(), destination);
if (!checkOnly) await mkdir(destinationPath, { recursive: true });

async function verifyAssets() {
  const manifest = JSON.parse(
    await readFile(path.join(runtimeSource, "runtime-manifest.json"), "utf8"),
  );
  const runtimeFiles = manifest.files.map(({ path: relativePath, size }) => ({
    relativePath,
    size,
    sourcePath: path.join(runtimeSource, relativePath),
  }));
  const standaloneFiles = [
    "runtime-manifest.json",
    "engine/xetex.mjs",
    "engine/xetex.wasm",
    "engine/xdvipdfmx.mjs",
    "engine/xdvipdfmx.wasm",
  ].map((relativePath) => ({
    relativePath,
    sourcePath: path.join(runtimeSource, relativePath),
  }));
  standaloneFiles.push({
    relativePath: "xelatex.worker.js",
    sourcePath: workerSource,
  });

  const expectedFiles = [...runtimeFiles, ...standaloneFiles];
  let totalBytes = 0;

  for (const file of expectedFiles) {
    const expectedSize = file.size ?? (await stat(file.sourcePath)).size;
    const destinationFile = path.join(destinationPath, file.relativePath);
    const metadata = await stat(destinationFile).catch(() => null);

    if (!metadata?.isFile()) {
      throw new Error(
        `Missing XeLaTeX asset: ${destinationFile}. Run thtex --to ${destination}.`,
      );
    }

    if (metadata.size !== expectedSize) {
      throw new Error(
        `Invalid XeLaTeX asset size: ${destinationFile} has ${metadata.size} bytes; expected ${expectedSize}.`,
      );
    }

    totalBytes += metadata.size;
  }

  return { fileCount: expectedFiles.length, totalBytes };
}

if (!checkOnly) {
  const [sourceRealPath, destinationRealPath] = await Promise.all([
    realpath(runtimeSource),
    realpath(destinationPath),
  ]);

  if (sourceRealPath !== destinationRealPath) {
    await cp(runtimeSource, destinationPath, {
      filter(source) {
        return path.basename(source) !== ".DS_Store";
      },
      force: true,
      recursive: true,
    });
  }

  await cp(workerSource, path.join(destinationPath, "xelatex.worker.js"), {
    force: true,
  });
}

const { fileCount, totalBytes } = await verifyAssets();
const sizeMiB = (totalBytes / (1024 * 1024)).toFixed(1);
console.log(
  `${checkOnly ? "Verified" : "Installed and verified"} ${fileCount} XeLaTeX assets (${sizeMiB} MiB) in ${destinationPath}`,
);
