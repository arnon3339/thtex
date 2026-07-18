#!/usr/bin/env node

import {
  cp,
  mkdir,
  readFile,
  realpath,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
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
  thtex [--to <directory>] [--max-file-size <size>]
  thtex --check [--to <directory>]

Options:
  --to <directory>       Destination directory (default: public/xelatex)
  --max-file-size <size> Split runtime files above this size (e.g. 24MiB)
  --check                Verify previously copied assets without changing them
  --help                 Show this help

The setup command copies and verifies the worker, WASM engines, ICU data,
fonts, and focused TeX runtime. It overwrites package-owned files but does not
delete unrelated files in the destination.`);
}

let destination = "public/xelatex";
let checkOnly = false;
let maxFileSize;

function parseSize(value) {
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|kib|mb|mib|gb|gib)?$/i.exec(value);

  if (!match) {
    throw new Error(
      `Invalid file size "${value}". Use bytes or a value such as 24MiB.`,
    );
  }

  const units = {
    b: 1,
    kb: 1_000,
    kib: 1024,
    mb: 1_000_000,
    mib: 1024 * 1024,
    gb: 1_000_000_000,
    gib: 1024 * 1024 * 1024,
  };
  const unit = (match[2] ?? "b").toLowerCase();
  const size = Math.floor(Number(match[1]) * units[unit]);

  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error(`Invalid file size "${value}".`);
  }

  return size;
}

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

  if (argument === "--max-file-size") {
    const value = process.argv[index + 1];

    if (!value) {
      throw new Error("--max-file-size requires a size such as 24MiB.");
    }

    maxFileSize = parseSize(value);
    index += 1;
    continue;
  }

  throw new Error(`Unknown argument: ${argument}`);
}

const destinationPath = path.resolve(process.cwd(), destination);
if (!checkOnly) await mkdir(destinationPath, { recursive: true });

async function verifyAssets() {
  const manifest = JSON.parse(
    await readFile(path.join(destinationPath, "runtime-manifest.json"), "utf8"),
  );
  const runtimeFiles = manifest.files.flatMap((file) =>
    file.chunks?.length
      ? file.chunks.map(({ path: relativePath, size }) => ({
          relativePath,
          size,
        }))
      : [{ relativePath: file.path, size: file.size }],
  );
  const standaloneFiles = [
    "engine/xetex.mjs",
    "engine/xetex.wasm",
    "engine/xdvipdfmx.mjs",
    "engine/xdvipdfmx.wasm",
  ].map((relativePath) => ({
    relativePath,
    sourcePath: path.join(runtimeSource, relativePath),
  }));
  standaloneFiles.push({
    relativePath: "runtime-manifest.json",
    sourcePath: path.join(destinationPath, "runtime-manifest.json"),
  });
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

    if (maxFileSize && metadata.size > maxFileSize) {
      throw new Error(
        `XeLaTeX asset ${destinationFile} is ${metadata.size} bytes, above --max-file-size ${maxFileSize}. Engine files cannot be split; choose a larger limit.`,
      );
    }
  }

  return { fileCount: expectedFiles.length, totalBytes };
}

if (!checkOnly) {
  const previousManifest = await readFile(
    path.join(destinationPath, "runtime-manifest.json"),
    "utf8",
  )
    .then(JSON.parse)
    .catch(() => null);

  for (const file of previousManifest?.files ?? []) {
    for (const chunk of file.chunks ?? []) {
      await unlink(path.join(destinationPath, chunk.path)).catch(() => undefined);
    }
  }

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

  if (maxFileSize) {
    const manifestPath = path.join(destinationPath, "runtime-manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

    for (const file of manifest.files) {
      if (file.size <= maxFileSize) continue;

      const sourcePath = path.join(destinationPath, file.path);
      const bytes = await readFile(sourcePath);
      const chunks = [];

      for (let offset = 0, part = 1; offset < bytes.length; part += 1) {
        const chunk = bytes.subarray(offset, offset + maxFileSize);
        const chunkPath = `${file.path}.part${String(part).padStart(3, "0")}`;
        const outputPath = path.join(destinationPath, chunkPath);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, chunk);
        chunks.push({ path: chunkPath, size: chunk.byteLength });
        offset += chunk.byteLength;
      }

      file.chunks = chunks;
      await unlink(sourcePath);
    }

    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

const { fileCount, totalBytes } = await verifyAssets();
const sizeMiB = (totalBytes / (1024 * 1024)).toFixed(1);
console.log(
  `${checkOnly ? "Verified" : "Installed and verified"} ${fileCount} XeLaTeX assets (${sizeMiB} MiB) in ${destinationPath}`,
);
