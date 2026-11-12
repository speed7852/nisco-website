// Writes the synthetic test CVs (PDF, DOCX and a scanned-style PDF without text) to a directory
// OUTSIDE the repository, for trying the master CV flow by hand against the local Worker.
//
//   node scripts/make-synthetic-cv.js /tmp/career-ai-synthetic
//
// All content is invented (see fixtures/synthetic-docs.js). Never commit these files.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { E2E_DIR } from "../e2e.config.js";
import { SYNTHETIC_CV_LINES, buildDocx, buildPdf } from "../fixtures/synthetic-docs.js";

const target = process.argv[2];
if (!target) {
  console.error("Usage: node scripts/make-synthetic-cv.js <directory outside the repository>");
  process.exit(2);
}
const directory = path.resolve(target);
const repository = path.resolve(E2E_DIR, "..", "..");
if (directory === repository || directory.startsWith(repository + path.sep)) {
  console.error(`Refusing to write inside the repository (${repository}). Choose a directory elsewhere.`);
  process.exit(2);
}
mkdirSync(directory, { recursive: true });
const files = {
  "Synthetic CV.pdf": buildPdf(),
  "Synthetic CV.docx": buildDocx(SYNTHETIC_CV_LINES, { header: ["Alex Synthetic · synthetic header"] }),
  "Scanned synthetic.pdf": buildPdf([[]]),
};
for (const [name, bytes] of Object.entries(files)) writeFileSync(path.join(directory, name), bytes);
console.log(`Wrote ${Object.keys(files).join(", ")} to ${directory}`);
