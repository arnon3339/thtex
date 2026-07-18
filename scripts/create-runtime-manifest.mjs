#!/usr/bin/env node

import { readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
let runtimeRoot = path.join(process.cwd(), "public", "xelatex");

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];

  if (argument === "--root") {
    const value = process.argv[index + 1];

    if (!value) {
      throw new Error("--root requires a directory path.");
    }

    runtimeRoot = path.resolve(process.cwd(), value);
    index += 1;
    continue;
  }

  if (argument === "--help" || argument === "-h") {
    console.log(`Generate a XeLaTeX WASM runtime manifest.

Usage:
  thtex-manifest [--root <runtime-directory>]

The default runtime directory is public/xelatex.`);
    process.exit(0);
  }

  throw new Error(`Unknown argument: ${argument}`);
}

const manifestPath = path.join(runtimeRoot, "runtime-manifest.json");
const assetDirectories = ["texmf", "fonts", "icu", "fontconfig"];

async function collectFiles(directory, prefix = "") {
  let entries;

  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }

  const files = [];

  for (const entry of entries.sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.name === ".DS_Store") {
      continue;
    }

    const absolutePath = path.join(directory, entry.name);
    const relativePath = path.posix.join(prefix, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      const metadata = await stat(absolutePath);
      files.push({ path: relativePath, size: metadata.size });
    }
  }

  return files;
}

const files = [];

for (const directory of assetDirectories) {
  files.push(
    ...(await collectFiles(
      path.join(runtimeRoot, directory),
      directory,
    )),
  );
}

await writeFile(
  manifestPath,
  `${JSON.stringify({ version: 1, files }, null, 2)}\n`,
  "utf8",
);

const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
console.log(
  `Wrote ${path.relative(process.cwd(), manifestPath)} with ${files.length} files (${totalBytes} bytes).`,
);
