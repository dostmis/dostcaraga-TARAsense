import nodemailer, { type Transporter } from "nodemailer";

/**
 * Minimal transactional email layer for TARAsense, backed by Gmail SMTP via
 * nodemailer. Used (initially) to send the Google sign-up confirmation magic
 * link. Configuration is read from env so no secrets are hard-coded:
 *
 *   GMAIL_USER          the Gmail address that sends the mail
 *   GMAIL_APP_PASSWORD  a 16-char Google "App Password" (requires 2-Step
 *                       Verification on that account)
 *
 * If the vars are missing, isEmailConfigured() returns false and callers
 * degrade gracefully instead of throwing.
 */

const FROM_NAME = "TARAsense";

function getUser() {
  return (process.env.GMAIL_USER ?? "").trim();
}

function getAppPassword() {
  // Google shows app passwords with spaces ("abcd efgh ijkl mnop"); strip them.
  return (process.env.GMAIL_APP_PASSWORD ?? "").replace(/\s+/g, "");
}

export function isEmailConfigured(): boolean {
  return Boolean(getUser() && getAppPassword());
}

let cachedTransporter: Transporter | null = null;

function getTransporter(): Transporter {
  if (!isEmailConfigured()) {
    throw new Error("Email is not configured (missing GMAIL_USER / GMAIL_APP_PASSWORD).");
  }
  if (!cachedTransporter) {
    cachedTransporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: getUser(), pass: getAppPassword() },
    });
  }
  return cachedTransporter;
}

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

/** Send an email. Returns true on success, false on failure (never throws). */
export async function sendMail(input: SendMailInput): Promise<boolean> {
  try {
    const transporter = getTransporter();
    await transporter.sendMail({
      from: `"${FROM_NAME}" <${getUser()}>`,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return true;
  } catch (error) {
    console.error("[email] sendMail failed:", error);
    return false;
  }
}
