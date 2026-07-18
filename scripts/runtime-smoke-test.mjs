#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  createEngine,
  loadRuntimeFiles,
  packageRoot,
  readRequiredFile,
} from "./runtime-node.mjs";

const sourceArgument = process.argv.slice(2).find((argument) => argument !== "--");
const sourcePath = sourceArgument
  ? path.resolve(sourceArgument)
  : path.join(packageRoot, "scripts", "runtime-smoke-test.tex");
const source = await readFile(sourcePath, "utf8");
const logLines = [];
const runtimeFiles = await loadRuntimeFiles();
const xetex = await createEngine("xetex", runtimeFiles, logLines);
xetex.FS.writeFile("/work/main.tex", source);

const xetexStatus = xetex.callMain([
  "-fmt=xelatex",
  "-no-pdf",
  "-interaction=nonstopmode",
  "-halt-on-error",
  "-file-line-error",
  "-output-directory=/work",
  "/work/main.tex",
]);

if (xetexStatus !== 0) {
  throw new Error(
    `XeTeX smoke test failed (status ${xetexStatus}).\n${logLines.slice(-30).join("\n")}`,
  );
}

const xdv = readRequiredFile(xetex, "/work/main.xdv");
const xdvipdfmx = await createEngine("xdvipdfmx", runtimeFiles, logLines);
xdvipdfmx.FS.writeFile("/work/main.xdv", xdv);
const pdfStatus = xdvipdfmx.callMain([
  "-o",
  "/work/main.pdf",
  "/work/main.xdv",
]);

if (pdfStatus !== 0) {
  throw new Error(
    `xdvipdfmx smoke test failed (status ${pdfStatus}).\n${logLines.slice(-30).join("\n")}`,
  );
}

const pdf = readRequiredFile(xdvipdfmx, "/work/main.pdf");
const header = new TextDecoder().decode(pdf.slice(0, 5));

if (header !== "%PDF-" || pdf.byteLength < 1_000) {
  throw new Error(`Runtime produced an invalid PDF (${pdf.byteLength} bytes).`);
}

console.log(
  `XeLaTeX runtime smoke test passed (${xdv.byteLength} byte XDV, ${pdf.byteLength} byte PDF).`,
);
