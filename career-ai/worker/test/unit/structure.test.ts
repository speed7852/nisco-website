import { describe, expect, it } from "vitest";
import { isGrounded, structureCvText, type Proposal } from "../../src/profile/structure";
import { valueStrings } from "../../src/profile/schema";
import { SYNTHETIC_CV_TEXT } from "../helpers";

const bySection = (proposals: Proposal[], section: string) => proposals.filter((p) => p.section === section).map((p) => p.value);

describe("fixed-rule CV structuring", () => {
  const proposals = structureCvText(SYNTHETIC_CV_TEXT);

  it("finds contact details verbatim", () => {
    expect(bySection(proposals, "name")).toEqual([{ text: "Alex Synthetic" }]);
    expect(bySection(proposals, "headline")).toEqual([{ text: "Programme Manager (synthetic test CV)" }]);
    expect(bySection(proposals, "email")).toEqual([{ text: "alex.synthetic@example.test" }]);
    expect(bySection(proposals, "phone")).toEqual([{ text: "+966 50 000 0000" }]);
    expect(bySection(proposals, "link")).toEqual([{ text: "https://example.test/alex" }]);
  });

  it("takes the summary and a stated number of years", () => {
    expect(bySection(proposals, "summary")).toEqual([{ text: "Synthetic summary for automated tests only. 12+ years of experience in PMO governance." }]);
    expect(bySection(proposals, "years_experience")).toEqual([{ text: "12" }]);
  });

  it("fills role and employer for 'Role at Employer' and 'Title | Employer', keeping dates as written", () => {
    const [first, second] = bySection(proposals, "experience");
    expect(first).toEqual({
      heading: "Senior Programme Manager at Example Holdings",
      role: "Senior Programme Manager",
      employer: "Example Holdings",
      start: "Jan 2020",
      end: "Present",
      achievements: ["Led a synthetic PMO of 5 people.", "Ran ITIL service transition for a fictional bank."],
    });
    expect(second).toEqual({
      heading: "Project Manager | Fictional Bank",
      role: "Project Manager",
      employer: "Fictional Bank",
      start: "2016",
      end: "2019",
      achievements: ["Delivered a synthetic core-banking upgrade."],
    });
  });

  it("proposes education, certifications and skills", () => {
    expect(bySection(proposals, "education")[0]).toMatchObject({ institution: "Example University", qualification: "BSc Computer Science", end: "2012" });
    expect(bySection(proposals, "certification")).toEqual([{ name: "PMP", issuer: "Synthetic Institute", date: "2018" }, { name: "ITIL 4 Foundation" }]);
    expect(bySection(proposals, "skill").map((value) => value.text)).toEqual(["PMO governance", "ITIL", "Stakeholder management", "Budgeting"]);
  });

  it("never proposes preferences: titles, approved locations, remote preference", () => {
    for (const section of ["preferred_title", "approved_location", "remote_preference", "preferred_titles_text"]) {
      expect(bySection(proposals, section)).toEqual([]);
    }
  });

  it("records a span that contains every proposed string", () => {
    for (const proposal of proposals) {
      const span = SYNTHETIC_CV_TEXT.slice(proposal.start, proposal.end);
      for (const value of valueStrings(proposal.value)) expect(span, proposal.section).toContain(value);
    }
  });

  it("recognises heading variants, inline headings and keeps undated experience as free text", () => {
    const text = "Jordan Example\nCore Competencies: Risk, Governance\nWORK HISTORY\nHelped several fictional teams.\nNo dates here.";
    const result = structureCvText(text);
    expect(bySection(result, "skill").map((v) => v.text)).toEqual(["Risk", "Governance"]);
    expect(bySection(result, "experience_text")).toEqual([{ text: "Helped several fictional teams.\nNo dates here." }]);
  });

  it("does not mistake a year range for a phone number", () => {
    const result = structureCvText("Sam Example\nAnalyst\n2016 - 2019\n");
    expect(bySection(result, "phone")).toEqual([]);
  });

  it("returns nothing for empty or heading-only text", () => {
    expect(structureCvText("")).toEqual([]);
    expect(structureCvText("SKILLS\nEXPERIENCE\n")).toEqual([]);
  });
});

/**
 * A synthetic CV in a common Word layout: the title on its own line, then "Employer | Location |
 * Dates", and bullets written as a Word list, so the extracted text carries no bullet characters.
 * Every name, place and number is invented.
 */
const WORD_LIST_CV = [
  "Riley Placeholder",
  "PMO Manager | Delivery Manager",
  "Example City, Example Country (synthetic) | +966 50 000 0000 | riley@example.test",
  "Professional Summary",
  "Synthetic summary for automated tests only. 9+ years in delivery.",
  "Core Skills",
  "Program & PMO: PMO Governance, Risk Management, WBS",
  "Tools & Platforms: Example BI, Example ERP",
  "Professional Experience",
  "Project Consultant (Freelance)",
  "Example Marketplace | Remote | Jan 2026 – Present",
  "Set up synthetic governance for fictional clients.",
  "Manage fictional client communication, scope and expectations remotely to deliver on time.",
  "PMO Lead",
  "Example Services Holdings | Example City, Example Country | May 2017 – Jul 2021",
  "Provided synthetic PMO governance and financial management across fictional programmes.",
  "Ran a placeholder portfolio review.",
  "Education",
  "Bachelor of Commerce, Example University, Example Country, 2009",
].join("\n");

describe("CVs written as Word lists with 'Title' above 'Employer | Location | Dates'", () => {
  const proposals = structureCvText(WORD_LIST_CV);

  it("fills title, employer and location, and keeps every bullet with its own entry", () => {
    expect(bySection(proposals, "experience")).toEqual([
      {
        heading: "Project Consultant (Freelance)",
        role: "Project Consultant (Freelance)",
        employer: "Example Marketplace",
        location: "Remote",
        start: "Jan 2026",
        end: "Present",
        achievements: [
          "Set up synthetic governance for fictional clients.",
          "Manage fictional client communication, scope and expectations remotely to deliver on time.",
        ],
      },
      {
        heading: "PMO Lead",
        role: "PMO Lead",
        employer: "Example Services Holdings",
        location: "Example City, Example Country",
        start: "May 2017",
        end: "Jul 2021",
        achievements: ["Provided synthetic PMO governance and financial management across fictional programmes.", "Ran a placeholder portfolio review."],
      },
    ]);
  });

  it("proposes the current location from the contact line, never the email, phone or name", () => {
    expect(bySection(proposals, "location_text")).toEqual([{ text: "Example City, Example Country (synthetic)" }]);
  });

  it("drops the category label from skills written as 'Category: a, b, c'", () => {
    expect(bySection(proposals, "skill").map((value) => value.text)).toEqual(["PMO Governance", "Risk Management", "WBS", "Example BI", "Example ERP"]);
  });

  it("splits 'Qualification, Institution, Country, Year' into its parts", () => {
    expect(bySection(proposals, "education")).toEqual([
      {
        heading: "Bachelor of Commerce, Example University, Example Country, 2009",
        qualification: "Bachelor of Commerce",
        institution: "Example University",
        end: "2009",
      },
    ]);
  });

  it("keeps every proposal grounded", () => {
    for (const proposal of proposals) expect(isGrounded(WORD_LIST_CV, proposal), proposal.section).toBe(true);
  });
});

describe("role and employer are left for the user when the reading is ambiguous", () => {
  const experience = (text: string) => bySection(structureCvText(`Sam Example\nEXPERIENCE\n${text}`), "experience");

  it("both sides look like titles, or neither does", () => {
    expect(experience("Lead Analyst\nManager Example Group | 2018 - 2020")[0]).toEqual({ heading: "Lead Analyst", start: "2018", end: "2020" });
    expect(experience("Example Group\nExample Holdings | 2018 - 2020")[0]).toEqual({ heading: "Example Group", start: "2018", end: "2020" });
  });

  it("reads 'Employer' above 'Title' above a date line", () => {
    expect(experience("Example Holdings\nSenior Programme Manager\n2018 - 2020")[0]).toEqual({
      heading: "Example Holdings\nSenior Programme Manager",
      role: "Senior Programme Manager",
      employer: "Example Holdings",
      start: "2018",
      end: "2020",
    });
  });

  it("never takes a full sentence above a date line as a header", () => {
    const [first, second] = experience(
      "Analyst at Example Bank\n2015 - 2017\nPrepared fictional weekly reports for a synthetic leadership team.\nConsultant at Example Advisory\n2017 - 2019",
    );
    expect(first).toMatchObject({ role: "Analyst", employer: "Example Bank", achievements: ["Prepared fictional weekly reports for a synthetic leadership team."] });
    expect(second).toMatchObject({ heading: "Consultant at Example Advisory", role: "Consultant", employer: "Example Advisory" });
  });

  it("does not read a year range or an experience line as a contact location", () => {
    expect(bySection(structureCvText("Sam Example\nExample Holdings | 2018 - 2020\nEXPERIENCE\nAnalyst | 2018 - 2020"), "location_text")).toEqual([]);
  });
});

describe("grounding invariant", () => {
  it("rejects proposals whose values are not in their span", () => {
    expect(isGrounded("abc def", { section: "skill", value: { text: "def" }, start: 4, end: 7 })).toBe(true);
    expect(isGrounded("abc def", { section: "skill", value: { text: "invented" }, start: 0, end: 7 })).toBe(false);
    expect(isGrounded("abc def", { section: "skill", value: { text: "abc" }, start: 4, end: 7 })).toBe(false);
    expect(isGrounded("abc", { section: "skill", value: { text: "abc" }, start: 0, end: 99 })).toBe(false);
    expect(isGrounded("abc", { section: "skill", value: {}, start: 0, end: 3 })).toBe(false);
  });

  it("holds for every proposal over many generated CV texts (fuzz)", () => {
    // Deterministic pseudo-random generator so the test is reproducible.
    let seed = 42;
    const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;
    const pieces = [
      "SKILLS", "Experience", "EDUCATION", "Certifications:", "Summary", "•", "-", "Jan 2019 – Present", "2015 - 2018", "03/2020 to 05/2022",
      "Lead at Fictional Co", "Analyst | Example Ltd", "PMP (Example Body), 2017", "a@b.test", "+1 555 000 0000", "https://example.test/x",
      "Example University", "MSc Data, 2010", "Ran, Built; Shipped | Tested", "Ünïcødé Ñame", "", "   ", "12 years of work", "(unbalanced", "))",
    ];
    for (let run = 0; run < 400; run += 1) {
      const lines = Array.from({ length: 5 + Math.floor(random() * 30) }, () => {
        const count = 1 + Math.floor(random() * 3);
        return Array.from({ length: count }, () => pick(pieces)).join(pick([" ", ", ", " | ", ""]));
      });
      const text = lines.join("\n");
      for (const proposal of structureCvText(text)) {
        expect(isGrounded(text, proposal), `${proposal.section} in run ${run}`).toBe(true);
      }
    }
  });
});
