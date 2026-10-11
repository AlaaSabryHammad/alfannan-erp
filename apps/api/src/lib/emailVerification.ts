/**
 * E-mail address confirmation.
 *
 * The link carries a signed, expiring token (no table): { userId, tenantId, email } under its own key,
 * so a session token can never be used as one and vice versa. The token is bound to the address it was
 * issued for — if the user's e-mail changed since, the old link stops working.
 */
import jwt from 'jsonwebtoken';
import prisma from './prisma';
import { runWithTenant } from './tenantContext';
import { publicBaseUrl } from './paymentService';
import { sendMail } from './mail/mailer';
import { verificationEmail } from './mail/templates';

export const VERIFY_VALID_HOURS = 48;

interface VerifyPayload {
  purpose: 'verify-email';
  userId: number;
  tenantId: number;
  email: string;
}

function key(): string {
  return `${process.env.JWT_SECRET ?? ''}:verify-email`;
}

export function signVerificationToken(user: { id: number; tenantId: number; email: string }): string {
  const payload: VerifyPayload = { purpose: 'verify-email', userId: user.id, tenantId: user.tenantId, email: user.email };
  return jwt.sign(payload, key(), { algorithm: 'HS256', expiresIn: `${VERIFY_VALID_HOURS}h` });
}

export type VerifyResult =
  | { ok: true; email: string; alreadyVerified: boolean }
  | { ok: false; reason: 'invalid' | 'expired' };

export async function confirmEmailToken(token: string): Promise<VerifyResult> {
  let payload: VerifyPayload;
  try {
    payload = jwt.verify(token, key(), { algorithms: ['HS256'] }) as VerifyPayload;
  } catch (err) {
    return { ok: false, reason: (err as Error).name === 'TokenExpiredError' ? 'expired' : 'invalid' };
  }
  if (payload.purpose !== 'verify-email') return { ok: false, reason: 'invalid' };

  return runWithTenant(payload.tenantId, async () => {
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || !user.isActive || user.email !== payload.email) return { ok: false as const, reason: 'invalid' as const };
    if (user.emailVerifiedAt) return { ok: true as const, email: user.email, alreadyVerified: true };
    await prisma.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    return { ok: true as const, email: user.email, alreadyVerified: false };
  });
}

/** Mails the confirmation link. Resolves true when the message was handed to the mail server. */
export async function sendVerificationEmail(
  user: { id: number; tenantId: number; email: string; name: string },
  companyName: string,
): Promise<boolean> {
  const url = `${publicBaseUrl()}/verify-email?token=${encodeURIComponent(signVerificationToken(user))}`;
  const mail = verificationEmail({ name: user.name, companyName, url, validHours: VERIFY_VALID_HOURS });
  return sendMail({ to: user.email, ...mail });
}
