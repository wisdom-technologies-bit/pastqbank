import { z } from "zod";

const clientEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
});

export function getClientEnv(source: NodeJS.ProcessEnv = process.env) {
  const result = clientEnvSchema.safeParse(source);
  if (!result.success) {
    const names = Object.keys(clientEnvSchema.shape).filter((key) => !source[key]);
    throw new Error(`Missing or invalid environment variables: ${names.join(", ")}`);
  }
  return result.data;
}

export const clientEnv = getClientEnv();
