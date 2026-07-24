import { describe, expect, it } from "vitest";
import { generateTemporaryPassword } from "./admin-password-action.mjs";

describe("generateTemporaryPassword", () => {
  it("creates secure 16-character passwords with every required character class", () => {
    for (let index = 0; index < 500; index += 1) {
      const password = generateTemporaryPassword();

      expect(password).toHaveLength(16);
      expect(password).toMatch(/[A-Z]/);
      expect(password).toMatch(/[a-z]/);
      expect(password).toMatch(/[0-9]/);
      expect(password).toMatch(/[!@#$%]/);
    }
  });
});
