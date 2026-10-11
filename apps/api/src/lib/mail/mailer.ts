/**
 * Outgoing e-mail.
 *
 * MAIL_DRIVER
 *   smtp   — send through SMTP_HOST (default when SMTP_HOST is set; Hostinger: smtp.hostinger.com:465)
 *   memory — keep messages in `outbox` (tests)
 *   off    — nothing is sent (default when SMTP is not configured); callers are told so
 *
 * Sending never throws: a mail server outage must not break registration or a request.
 */
import nodemailer, { Transporter } from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export const outbox: MailMessage[] = [];

type Driver = 'smtp' | 'memory' | 'off';

function driver(): Driver {
  const configured = process.env.MAIL_DRIVER?.trim().toLowerCase();
  if (configured === 'smtp' || configured === 'memory' || configured === 'off') return configured;
  return process.env.SMTP_HOST?.trim() ? 'smtp' : 'off';
}

export function mailEnabled(): boolean {
  return driver() !== 'off';
}

let transporter: Transporter | null = null;

function smtp(): Transporter {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT) || 465;
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? '' } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }
  return transporter;
}

function sender(): string {
  const from = process.env.MAIL_FROM?.trim() || process.env.SMTP_USER?.trim() || '';
  return from;
}

/** true when the message was handed to the mail server (or the test outbox). */
export async function sendMail(message: MailMessage): Promise<boolean> {
  const mode = driver();
  if (mode === 'off') {
    console.warn('mail: not configured (SMTP_HOST) — message to %s was not sent', message.to);
    return false;
  }
  if (mode === 'memory') {
    outbox.push(message);
    return true;
  }
  try {
    await smtp().sendMail({ from: sender(), ...message });
    return true;
  } catch (err) {
    console.error('mail: sending failed —', (err as Error).message);
    return false;
  }
}
