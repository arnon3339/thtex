#!/usr/bin/env node

import { cp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import process from "node:process";
import { engineRoot, packageRoot, runtimeRoot } from "./runtime-node.mjs";

let artifactsRoot = process.env.XELATEX_ARTIFACTS_DIR
  ? path.resolve(process.env.XELATEX_ARTIFACTS_DIR)
  : path.resolve(packageRoot, "..", "xelatex-artifacts");

for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];

  if (argument === "--from") {
    const value = process.argv[index + 1];
    if (!value) throw new Error("--from requires a directory path.");
    artifactsRoot = path.resolve(value);
    index += 1;
    continue;
  }

  if (argument === "--help" || argument === "-h") {
    console.log(`Synchronize browser XeTeX artifacts into xelatex-wasm.

Usage:
  sync-engine-artifacts [--from <xelatex-artifacts-directory>]

Defaults to ../xelatex-artifacts. XELATEX_ARTIFACTS_DIR can override it.`);
    process.exit(0);
  }

  throw new Error(`Unknown argument: ${argument}`);
}

const requiredMappings = [
  ["browser/xetex/xetex.mjs", "engine/xetex.mjs"],
  ["browser/xetex/xetex.wasm", "engine/xetex.wasm"],
  ["browser/xdvipdfmx/xdvipdfmx.mjs", "engine/xdvipdfmx.mjs"],
  ["browser/xdvipdfmx/xdvipdfmx.wasm", "engine/xdvipdfmx.wasm"],
  ["browser/bibtex/bibtex.mjs", "engine/bibtex.mjs"],
  ["browser/bibtex/bibtex.wasm", "engine/bibtex.wasm"],
];

// ICU is runtime data rather than a compiled engine. Copy it when the artifact
// bundle provides it, otherwise retain the checked-in runtime copy.
const optionalMappings = [
  ["browser/icu/icudt76l.dat", "icu/icudt76l.dat"],
  ["browser/icu/LICENSE", "icu/LICENSE"],
  [
    "browser/icu/icu4c-76_1-data-bin-l-README.md",
    "icu/icu4c-76_1-data-bin-l-README.md",
  ],
];

await mkdir(engineRoot, { recursive: true });
const files = [];

async function copyArtifact(
  sourceRelativePath,
  destinationRelativePath,
  { required },
) {
  const sourcePath = path.join(artifactsRoot, sourceRelativePath);
  const metadata = await stat(sourcePath).catch(() => null);

  if (!metadata?.isFile() || metadata.size === 0) {
    if (required) {
      throw new Error(`Missing XeLaTeX artifact: ${sourcePath}`);
    }
    return;
  }

  const destinationPath = path.join(runtimeRoot, destinationRelativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: true });
  const bytes = await readFile(destinationPath);
  files.push({
    artifact: sourceRelativePath,
    output: destinationRelativePath,
    size: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  });
}

for (const mapping of requiredMappings) {
  await copyArtifact(...mapping, { required: true });
}

for (const mapping of optionalMappings) {
  await copyArtifact(...mapping, { required: false });
}

await writeFile(
  path.join(engineRoot, "artifacts.json"),
  `${JSON.stringify({ version: 1, files }, null, 2)}\n`,
  "utf8",
);

console.log(`Synchronized ${files.length} browser runtime artifacts from ${artifactsRoot}.`);
