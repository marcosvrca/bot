import { describe, expect, it } from "vitest";
import { isSkip, parseEmail, parseRequiredText } from "./leads.parse.js";

describe("leads.parse", () => {
  it("validates email", () => {
    expect(parseEmail("User@Example.com")).toBe("user@example.com");
    expect(parseEmail("invalid")).toBeNull();
    expect(parseEmail("a@b")).toBeNull();
  });

  it("parses required text", () => {
    expect(parseRequiredText("  Ana  Silva ")).toBe("Ana Silva");
    expect(parseRequiredText("A")).toBeNull();
  });

  it("detects skip", () => {
    expect(isSkip("pular")).toBe(true);
    expect(isSkip("não")).toBe(true);
    expect(isSkip("sim")).toBe(false);
  });
});
