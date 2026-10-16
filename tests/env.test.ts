import { describe, expect, it } from "vitest";
import { getServerEnv } from "@/lib/env/server";

describe("server environment validation", () => { it("reports missing variable names without values", () => { expect(() => getServerEnv({})).toThrow(/NEXT_PUBLIC_SUPABASE_URL/); expect(() => getServerEnv({})).not.toThrow(/secret|password|token/i); }); });
