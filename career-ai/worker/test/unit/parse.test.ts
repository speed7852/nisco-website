import { describe, expect, it } from "vitest";
import { extractJsonObject, parseMatchAssessment } from "../../src/ai/parse";
import { extractModelOutput } from "../../src/ai/client";

const good = { score: 85, matched: ["PMO governance"], gaps: ["PMP certification"], rationale: "Strong PMO fit." };

describe("parseMatchAssessment: accepted shapes (audit P10, P12)", () => {
  it("accepts clean JSON text", () => {
    const result = parseMatchAssessment(JSON.stringify(good));
    expect(result).toEqual({ ok: true, clamped: false, assessment: good });
  });

  it("accepts ```json fenced output", () => {
    const result = parseMatchAssessment("```json\n" + JSON.stringify(good) + "\n```");
    expect(result.ok && result.assessment.score).toBe(85);
  });

  it("accepts JSON preceded and followed by prose (P10)", () => {
    const result = parseMatchAssessment(`Here is my assessment:\n${JSON.stringify(good)}\nLet me know if you need more.`);
    expect(result.ok && result.assessment).toEqual(good);
  });

  it("accepts an object response from JSON mode (P12)", () => {
    expect(parseMatchAssessment(good)).toEqual({ ok: true, clamped: false, assessment: good });
  });

  it("accepts numeric text scores such as \"72\" and \"72%\"", () => {
    expect(parseMatchAssessment({ ...good, score: "72" }).ok).toBe(true);
    const result = parseMatchAssessment({ ...good, score: "72%" });
    expect(result.ok && result.assessment.score).toBe(72);
  });

  it("skips a non-JSON brace group before the real object", () => {
    const result = parseMatchAssessment(`Format {score, matched}: ${JSON.stringify(good)}`);
    expect(result.ok && result.assessment.score).toBe(85);
  });

  it("handles braces inside JSON strings", () => {
    const result = parseMatchAssessment(`Result: {"score": 60, "rationale": "uses {curly} text"}`);
    expect(result.ok && result.assessment.rationale).toBe("uses {curly} text");
  });
});

describe("parseMatchAssessment: clamping (audit P11)", () => {
  it("clamps 150 to 100 and reports it", () => {
    expect(parseMatchAssessment({ score: 150 })).toMatchObject({ ok: true, clamped: true, assessment: { score: 100 } });
  });

  it("clamps negative scores to 0", () => {
    expect(parseMatchAssessment({ score: -20 })).toMatchObject({ ok: true, clamped: true, assessment: { score: 0 } });
  });

  it("rounds fractional scores", () => {
    expect(parseMatchAssessment({ score: 79.6 })).toMatchObject({ ok: true, assessment: { score: 80 } });
  });
});

describe("parseMatchAssessment: rejected output", () => {
  it.each([
    ["garbage text", "I cannot assess this."],
    ["empty string", ""],
    ["missing score", JSON.stringify({ matched: [] })],
    ["non-numeric score", JSON.stringify({ score: "high" })],
    ["NaN-like score", JSON.stringify({ score: "85 points out of 100" })],
    ["array", JSON.stringify([85])],
    ["null", null],
    ["number", 85],
    ["unterminated JSON", '{"score": 85, "matched": ['],
  ])("rejects %s", (_label, output) => {
    expect(parseMatchAssessment(output).ok).toBe(false);
  });

  it("drops non-string list items and caps list length", () => {
    const result = parseMatchAssessment({ score: 50, matched: ["a", 1, null, "b", ...Array(30).fill("x")], gaps: "single gap" });
    expect(result.ok && result.assessment.matched.slice(0, 2)).toEqual(["a", "b"]);
    expect(result.ok && result.assessment.matched.length).toBe(20);
    expect(result.ok && result.assessment.gaps).toEqual(["single gap"]);
  });
});

describe("extractModelOutput", () => {
  it.each([
    [{ response: "text" }, "text"],
    [{ response: { score: 1 } }, { score: 1 }],
    [{ result: { response: "nested" } }, "nested"],
    [{ choices: [{ message: { content: "openai" } }] }, "openai"],
    ["bare", "bare"],
    [null, undefined],
  ])("reads %j", (input, expected) => {
    expect(extractModelOutput(input)).toEqual(expected);
  });

  it("extractJsonObject returns undefined when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeUndefined();
  });
});
