import { describe, expect, it, vi } from "vitest";
import { verifyCron } from "@/lib/security/verifyCron";
vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
vi.stubEnv("CRON_SECRET", "1234567890123456");
vi.stubEnv("BANK_SERVICE_API_KEY", "12345678901234567890123456789012");
describe("verifyCron",()=>{const request=(authorization?:string)=>new Request("http://localhost",authorization?{headers:{authorization}}:undefined);it("accepts the correct bearer secret",()=>expect(verifyCron(request("Bearer 1234567890123456"))).toBe(true));it("rejects wrong, missing, different length, and malformed headers",()=>{expect(verifyCron(request("Bearer wrong"))).toBe(false);expect(verifyCron(request())).toBe(false);expect(verifyCron(request("Bearer short"))).toBe(false);expect(verifyCron(request("1234567890123456"))).toBe(false)})});
