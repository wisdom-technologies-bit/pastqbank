import { describe, expect, it, vi, beforeEach } from "vitest";
import { discoverKeys, maskKey, clearCoolingForTests } from "@/lib/providers/aloc/keyPool";
import { AlocRateLimitedError } from "@/lib/providers/aloc/errors";
describe("ALOC key utilities", () => { beforeEach(() => { clearCoolingForTests(); }); it("sorts numbered keys and ignores unrelated variables", () => { expect(discoverKeys({ ALOC_API_KEY_10: "ten", ALOC_API_KEY_2: "two", OTHER: "no" })).toEqual([{ envVarName: "ALOC_API_KEY_2", label: "Key 2", secret: "two" }, { envVarName: "ALOC_API_KEY_10", label: "Key 10", secret: "ten" }]); }); it("masks everything except the last four characters", () => expect(maskKey("recognisable-secret")).toBe("…cret")); });
describe("ALOC response behavior", () => { it("never places a secret in a rate-limit error", () => { const secret = "recognisable-fake-secret"; const error = new AlocRateLimitedError(20); expect(`${error.message}${error.stack}`).not.toContain(secret); }); });
