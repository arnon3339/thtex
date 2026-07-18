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
const bibliography = await readFile(
  path.join(packageRoot, "scripts", "runtime-smoke-test.bib"),
);
const logLines = [];
const runtimeFiles = await loadRuntimeFiles();

async function runXeTeX(passFiles = []) {
  const xetex = await createEngine("xetex", runtimeFiles, logLines);
  xetex.FS.writeFile("/work/main.tex", source);
  xetex.FS.writeFile("/work/references.bib", bibliography);

  for (const [filePath, bytes] of passFiles) {
    xetex.FS.writeFile(filePath, bytes);
  }

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
    throw new Error(
      `XeTeX smoke test failed (status ${status}).\n${logLines.slice(-30).join("\n")}`,
    );
  }

  return xetex;
}

const firstPass = await runXeTeX();
const aux = readRequiredFile(firstPass, "/work/main.aux");

const bibtex = await createEngine("bibtex", runtimeFiles, logLines);
bibtex.FS.writeFile("/work/main.aux", aux);
bibtex.FS.writeFile("/work/references.bib", bibliography);
const bibtexStatus = bibtex.callMain(["main"]);

if (bibtexStatus !== 0) {
  throw new Error(
    `BibTeX smoke test failed (status ${bibtexStatus}).\n${logLines.slice(-30).join("\n")}`,
  );
}

const bbl = readRequiredFile(bibtex, "/work/main.bbl");
const bblText = new TextDecoder().decode(bbl);

if (!bblText.includes("Knuth") || !bblText.includes("The TeXbook")) {
  throw new Error("BibTeX output does not contain the expected bibliography entry.");
}

const secondPass = await runXeTeX([
  ["/work/main.aux", aux],
  ["/work/main.bbl", bbl],
]);
const xdv = readRequiredFile(secondPass, "/work/main.xdv");
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
  `XeLaTeX + BibTeX runtime smoke test passed (${bbl.byteLength} byte BBL, ${xdv.byteLength} byte XDV, ${pdf.byteLength} byte PDF).`,
);
