import { describe, expect, it } from "vitest";
import { parseDateTime, parseReminderMinutes } from "./scheduling.parse.js";

describe("parseReminderMinutes", () => {
  it("defaults to 60 minutes", () => {
    expect(parseReminderMinutes("")).toBe(60);
    expect(parseReminderMinutes("padrão")).toBe(60);
    expect(parseReminderMinutes("ok")).toBe(60);
  });

  it("parses units", () => {
    expect(parseReminderMinutes("30 minutos")).toBe(30);
    expect(parseReminderMinutes("1 hora")).toBe(60);
    expect(parseReminderMinutes("2h")).toBe(120);
    expect(parseReminderMinutes("1 dia")).toBe(1440);
  });
});

describe("parseDateTime", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");

  it("parses DD/MM/YYYY HH:MM", () => {
    const parsed = parseDateTime("29/07/2026 14:30", now);
    expect(parsed).not.toBeNull();
    expect(parsed!.date.toISOString()).toContain("2026-07-29");
  });

  it("parses amanhã with time", () => {
    const parsed = parseDateTime("amanhã 09:15", now);
    expect(parsed).not.toBeNull();
  });

  it("rejects invalid", () => {
    expect(parseDateTime("qualquer coisa", now)).toBeNull();
  });
});
