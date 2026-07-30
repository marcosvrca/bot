import { describe, expect, it } from "vitest";
import { isOwnerPhone, phoneMatchKeys } from "./owner.model.js";

describe("phoneMatchKeys / isOwnerPhone", () => {
  it("equates BR mobile with and without ninth digit", () => {
    expect(phoneMatchKeys("5563985152806").sort()).toEqual(
      ["556385152806", "5563985152806"].sort(),
    );
    expect(phoneMatchKeys("556385152806").sort()).toEqual(
      ["556385152806", "5563985152806"].sort(),
    );
  });

  it("matches owner when WhatsApp omits the 9", () => {
    expect(isOwnerPhone(["5563985152806"], "556385152806")).toBe(true);
    expect(isOwnerPhone(["556385152806"], "5563985152806")).toBe(true);
  });

  it("rejects unrelated numbers", () => {
    expect(isOwnerPhone(["5563985152806"], "5511999999999")).toBe(false);
    expect(isOwnerPhone(undefined, "556385152806")).toBe(false);
  });
});
