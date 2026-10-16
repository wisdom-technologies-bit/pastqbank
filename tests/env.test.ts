import { describe, expect, it } from "vitest";
import { getServerEnv } from "@/lib/env/server";

describe("server environment validation", () => {
  it("reports missing variable names without exposing values", () => {
    const original = { ...process.env };
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "BANK_SERVICE_API_KEY"]) delete process.env[name];

    expect(() => getServerEnv()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
    try {
      getServerEnv();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("BANK_SERVICE_API_KEY");
      expect(message).not.toContain("test-secret-value");
      expect(message).not.toContain("test-password-value");
    }

    process.env = original;
  });
});
