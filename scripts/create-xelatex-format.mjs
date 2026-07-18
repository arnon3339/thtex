#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createEngine,
  formatPath,
  loadRuntimeFiles,
  packageRoot,
  readRequiredFile,
} from "./runtime-node.mjs";

const runtimeFiles = await loadRuntimeFiles({ includeFormat: false });
const logLines = [];
const xetex = await createEngine("xetex", runtimeFiles, logLines);
const status = xetex.callMain([
  "-ini",
  "-etex",
  "-jobname=xelatex",
  "-interaction=nonstopmode",
  "-halt-on-error",
  "-output-directory=/work",
  "/texmf/web2c/xelatex.ini",
]);

if (status !== 0) {
  throw new Error(
    `XeTeX could not build xelatex.fmt (status ${status}).\n${logLines.slice(-20).join("\n")}`,
  );
}

const format = readRequiredFile(xetex, "/work/xelatex.fmt");
await writeFile(formatPath, format);
console.log(
  `Wrote ${path.relative(packageRoot, formatPath)} (${format.byteLength} bytes).`,
);
