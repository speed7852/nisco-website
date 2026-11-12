// Unit tests for joining pdf.js text items into lines (frontend/js/pdf-text.js).
import assert from "node:assert/strict";
import { test } from "node:test";
import { joinTextItems } from "../../frontend/js/pdf-text.js";

const item = (str, x, y, width = str.length * 5, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, x, y], width, hasEOL });

test("starts a new line when the baseline moves", () => {
  assert.equal(joinTextItems([item("Alex Synthetic", 56, 780), item("Programme Manager", 56, 765)]), "Alex Synthetic\nProgramme Manager");
});

test("keeps fragments on the same baseline together, adding a space only for visible gaps", () => {
  assert.equal(joinTextItems([item("Senior", 56, 700, 30), item("Manager", 90, 700.5)]), "Senior Manager");
  assert.equal(joinTextItems([item("Pro", 56, 700, 15), item("gramme", 71, 700)]), "Programme");
  assert.equal(joinTextItems([item("Senior ", 56, 700, 35), item("Manager", 95, 700)]), "Senior Manager");
});

test("honours hasEOL and empty items", () => {
  assert.equal(joinTextItems([item("Line", 56, 700, 20, true), item("", 0, 0, 0, true), item("Next", 56, 700)]), "Line\nNext");
});

test("ignores items without text and trims trailing whitespace on each line", () => {
  assert.equal(joinTextItems([{ type: "beginMarkedContent" }, item("Text   ", 56, 700, 30, true), item("More", 56, 690)]), "Text\nMore");
  assert.equal(joinTextItems([]), "");
});
