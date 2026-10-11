/**
 * Start-up checks for production.
 *  - a placeholder JWT secret lets anyone forge sessions → refuse to boot
 *  - a short one is only warned about (so an existing deployment is not taken down by an upgrade)
 */
const PLACEHOLDER = /change-?me|your-?secret|secret-?key|example|placeholder|^password$/i;

export function assertSafeEnvironment(): void {
  if (process.env.NODE_ENV !== 'production') return;

  const jwt = process.env.JWT_SECRET ?? '';
  if (!jwt || PLACEHOLDER.test(jwt)) {
    console.error('✖ JWT_SECRET is missing or still a placeholder — refusing to start');
    process.exit(1);
  }
  if (jwt.length < 32) {
    console.warn('⚠ JWT_SECRET is shorter than 32 characters — generate a longer one (openssl rand -hex 32)');
  }
}
