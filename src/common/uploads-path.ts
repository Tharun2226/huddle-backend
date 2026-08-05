import { join } from 'path';

/** Writable uploads root — `/tmp` on Vercel, local `uploads/` otherwise. */
export function uploadsRoot(): string {
  const fromEnv = process.env.UPLOADS_DIR?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.VERCEL) return join('/tmp', 'huddle-uploads');
  return join(process.cwd(), 'uploads');
}
