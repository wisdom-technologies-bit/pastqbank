import "server-only";

import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CRON_SECRET: z.string().min(16),
  BANK_SERVICE_API_KEY: z.string().min(32),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(source: NodeJS.ProcessEnv = process.env): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    const missing = Object.keys(serverEnvSchema.shape).filter((key) => {
      const value = source[key];
      return !value || value.length === 0;
    });
    const invalid = result.error.issues
      .map((issue) => issue.path.join("."))
      .filter((name) => !missing.includes(name));
    const names = [...new Set([...missing, ...invalid])];
    throw new Error(`Missing or invalid environment variables: ${names.join(", ")}`);
  }
  return result.data;
}

export const serverEnv = getServerEnv();
