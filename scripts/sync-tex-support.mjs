#!/usr/bin/env node

import { execFile } from "node:child_process";
import { cp, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { runtimeRoot } from "./runtime-node.mjs";

const execFileAsync = promisify(execFile);

async function resolveTexmfDist() {
  if (process.env.XELATEX_TEXMF_DIST) {
    return path.resolve(process.env.XELATEX_TEXMF_DIST);
  }

  const { stdout } = await execFileAsync("kpsewhich", [
    "-var-value=TEXMFDIST",
  ]);
  const value = stdout.trim();
  if (!value) throw new Error("kpsewhich did not return TEXMFDIST.");
  return path.resolve(value);
}

const texmfDist = await resolveTexmfDist();
const mappings = [
  ["tex/latex/base/size11.clo", "texmf/tex/latex/base/size11.clo"],
  ["tex/latex/base/size12.clo", "texmf/tex/latex/base/size12.clo"],
  ["tex/latex/graphics/color.sty", "texmf/tex/latex/graphics/color.sty"],
  ["fonts/opentype/public/lm/lmroman10-regular.otf", "fonts/lmroman10-regular.otf"],
  ["fonts/opentype/public/lm/lmroman10-bold.otf", "fonts/lmroman10-bold.otf"],
  ["fonts/opentype/public/lm/lmroman10-italic.otf", "fonts/lmroman10-italic.otf"],
  ["fonts/opentype/public/lm/lmroman10-bolditalic.otf", "fonts/lmroman10-bolditalic.otf"],
  ["fonts/opentype/public/lm/lmroman12-regular.otf", "fonts/lmroman12-regular.otf"],
  ["fonts/opentype/public/lm/lmroman12-bold.otf", "fonts/lmroman12-bold.otf"],
  ["fonts/opentype/public/lm/lmroman12-italic.otf", "fonts/lmroman12-italic.otf"],
];

const directoryMappings = [
  ["fonts/tfm/public/cm", "texmf/fonts/tfm/public/cm"],
  [
    "fonts/tfm/public/amsfonts/cmextra",
    "texmf/fonts/tfm/public/amsfonts/cmextra",
  ],
  ["fonts/type1/public/amsfonts/cm", "texmf/fonts/type1/public/amsfonts/cm"],
  [
    "fonts/type1/public/amsfonts/cmextra",
    "texmf/fonts/type1/public/amsfonts/cmextra",
  ],
];

for (const [sourceRelativePath, destinationRelativePath] of mappings) {
  const sourcePath = path.join(texmfDist, sourceRelativePath);
  const metadata = await stat(sourcePath).catch(() => null);

  if (!metadata?.isFile() || metadata.size === 0) {
    throw new Error(`Missing TeX support file: ${sourcePath}`);
  }

  const destinationPath = path.join(runtimeRoot, destinationRelativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(sourcePath, destinationPath, { force: true });
}

for (const [sourceRelativePath, destinationRelativePath] of directoryMappings) {
  const sourcePath = path.join(texmfDist, sourceRelativePath);
  const metadata = await stat(sourcePath).catch(() => null);

  if (!metadata?.isDirectory()) {
    throw new Error(`Missing TeX support directory: ${sourcePath}`);
  }

  const destinationPath = path.join(runtimeRoot, destinationRelativePath);
  await mkdir(destinationPath, { recursive: true });
  await cp(sourcePath, destinationPath, { recursive: true, force: true });
}

for (const fileName of [
  "lmroman10-regular.ttf",
  "lmroman10-bold.ttf",
  "lmroman10-italic.ttf",
  "lmroman10-bolditalic.ttf",
  "lmroman12-regular.ttf",
  "lmroman12-bold.ttf",
  "lmroman12-italic.ttf",
]) {
  await rm(path.join(runtimeRoot, "fonts", fileName), { force: true });
}

console.log(
  `Synchronized ${mappings.length} TeX support files and ${directoryMappings.length} font directories.`,
);
