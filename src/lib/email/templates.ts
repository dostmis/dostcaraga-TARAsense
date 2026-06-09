/**
 * Email templates. Emails can only use inline styles + hard-coded colors (no
 * Tailwind/CSS variables), so the TARAsense brand palette is mirrored here:
 *   brand #1746ff · foreground #191b29 · background #fbf9f5 · surface #ffffff
 */

const BRAND = "#1746ff";
const FOREGROUND = "#191b29";
const MUTED = "#5b5f72";
const BACKGROUND = "#fbf9f5";
const SURFACE = "#ffffff";
const BORDER = "#e6e1d8";

type ConfirmationEmailInput = {
  name: string;
  confirmUrl: string;
  /** Token lifetime in minutes, used in the copy. */
  expiresMinutes: number;
};

export function googleSignupConfirmationEmail({ name, confirmUrl, expiresMinutes }: ConfirmationEmailInput) {
  const subject = "Confirm your TARAsense sign-in";
  const greeting = name && name.trim().length >= 2 ? `Hi ${escapeHtml(name)},` : "Hi there,";

  const text = [
    `${greeting.replace(/<[^>]*>/g, "")}`,
    "",
    "Confirm your sign-in to finish creating your TARAsense account:",
    confirmUrl,
    "",
    `This link expires in ${expiresMinutes} minutes. If you didn't try to sign in, you can ignore this email.`,
    "",
    "— TARAsense",
  ].join("\n");

  const html = `<!DOCTYPE html>
<html lang="en">
  <body style="margin:0;padding:0;background-color:${BACKGROUND};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${BACKGROUND};padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:${SURFACE};border:1px solid ${BORDER};border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 32px 8px 32px;">
                <div style="font-size:20px;font-weight:700;color:${FOREGROUND};">TARAsense</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <p style="margin:0 0 12px 0;font-size:15px;color:${FOREGROUND};">${greeting}</p>
                <p style="margin:0 0 8px 0;font-size:15px;line-height:1.6;color:${FOREGROUND};">
                  Confirm your sign-in to finish creating your TARAsense account.
                </p>
              </td>
            </tr>
            <tr>
              <td align="center" style="padding:24px 32px 8px 32px;">
                <a href="${confirmUrl}" target="_blank"
                   style="display:inline-block;background-color:${BRAND};color:#ffffff;text-decoration:none;font-size:15px;font-weight:600;padding:13px 28px;border-radius:999px;">
                  Confirm sign-in
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 0 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};">
                  This link expires in ${expiresMinutes} minutes. If you didn't try to sign in to TARAsense, you can safely ignore this email.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 32px 24px 32px;">
                <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED};word-break:break-all;">
                  Button not working? Paste this link into your browser:<br />
                  <a href="${confirmUrl}" target="_blank" style="color:${BRAND};">${confirmUrl}</a>
                </p>
              </td>
            </tr>
          </table>
          <p style="margin:16px 0 0 0;font-size:11px;color:${MUTED};">© TARAsense · DOST Caraga</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
