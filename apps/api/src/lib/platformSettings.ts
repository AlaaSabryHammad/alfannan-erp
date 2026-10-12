/**
 * Platform-wide switches the owner can flip from the console without redeploying.
 *
 * Stored in the PlatformSetting table (owner connection only). When a key has no stored value the
 * environment variable decides, so an existing deployment behaves exactly as before.
 */
import { platformPrisma as db } from './platformPrisma';

const TTL_MS = 10_000;
const cache = new Map<string, { value: string | null; at: number }>();

export async function getSetting(key: string): Promise<string | null> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: string | null = null;
  try {
    value = (await db.platformSetting.findUnique({ where: { key } }))?.value ?? null;
  } catch {
    // the table is not there yet (first boot before the migration): fall back to the environment
    value = null;
  }
  cache.set(key, { value, at: Date.now() });
  return value;
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null) await db.platformSetting.deleteMany({ where: { key } });
  else await db.platformSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
  cache.delete(key);
}

export function _resetSettingsCache(): void {
  cache.clear();
}

export interface SignupState {
  enabled: boolean;
  /** console = set by the owner from the console; env = ALLOW_SIGNUP of the deployment */
  source: 'console' | 'env';
}

export async function signupState(): Promise<SignupState> {
  const stored = await getSetting('signup.enabled');
  if (stored === 'true' || stored === 'false') return { enabled: stored === 'true', source: 'console' };
  return { enabled: process.env.ALLOW_SIGNUP === 'true', source: 'env' };
}
