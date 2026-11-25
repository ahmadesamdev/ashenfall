import nodemailer, { type Transporter } from "nodemailer";

const CODE_EXPIRY_MINUTES = 15;

type EmailProvider = "sendgrid" | "resend" | "smtp" | "none";

const HTTP_TIMEOUT_MS = 10_000;

function parseSender(value: string): { name: string; email: string } {
  const match = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(value);
  if (match) return { name: match[1].trim(), email: match[2].trim() };
  return { name: "", email: value.trim() };
}

async function describeHttpFailure(
  provider: string,
  response: Response,
): Promise<string> {
  let detail = "";
  try {
    const body: any = await response.json();
    detail = String(
      body?.errors?.[0]?.message || body?.message || body?.error || "",
    ).trim();
  } catch {}
  return `${provider} rejected the email (HTTP ${response.status})${detail ? `: ${detail}` : ""}`;
}

export class EmailService {
  private readonly transporter: Transporter | null;
  private readonly sendGridKey: string;
  private readonly resendKey: string;
  readonly provider: EmailProvider;
  readonly from: string;
  readonly configured: boolean;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.sendGridKey = String(env.SENDGRID_API_KEY || "").trim();
    this.resendKey = String(env.RESEND_API_KEY || "").trim();
    const host = String(env.SMTP_HOST || "").trim();

    this.provider = this.sendGridKey
      ? "sendgrid"
      : this.resendKey
        ? "resend"
        : host
          ? "smtp"
          : "none";
    this.configured = this.provider !== "none";

    const explicitFrom = String(env.EMAIL_FROM || env.SMTP_FROM || "").trim();
    this.from =
      explicitFrom ||
      (this.provider === "smtp" ? String(env.SMTP_USER || "").trim() : "") ||
      "no-reply@ashenfall.local";

    this.transporter =
      this.provider === "smtp"
        ? nodemailer.createTransport({
            host,
            port: Number(env.SMTP_PORT || 587),
            secure: String(env.SMTP_SECURE || "false") === "true",
            auth: env.SMTP_USER
              ? { user: env.SMTP_USER, pass: String(env.SMTP_PASS || "") }
              : undefined,
            connectionTimeout: 8000,
            greetingTimeout: 8000,
            socketTimeout: 10000,
          })
        : null;
  }

  async sendPasswordReset(to: string, code: string): Promise<void> {
    await this.sendCodeEmail(
      to,
      code,
      "Password reset code",
      "Use this code to reset your password:",
    );
  }

  async sendVerification(to: string, code: string): Promise<void> {
    await this.sendCodeEmail(
      to,
      code,
      "Verify your email",
      "Use this verification code to finish creating your account:",
    );
  }

  private async sendCodeEmail(
    to: string,
    code: string,
    subjectSuffix: string,
    instruction: string,
  ): Promise<void> {
    const recipient = String(to || "").trim();
    const verificationCode = String(code || "").trim();
    if (!recipient || !verificationCode)
      throw new Error("Email recipient and verification code are required.");

    const subject = `Ashenfall — ${subjectSuffix}`;
    const text = `${instruction} ${verificationCode}. It expires in ${CODE_EXPIRY_MINUTES} minutes.`;
    const html = this.renderCodeEmail(instruction, verificationCode);

    if (this.provider === "sendgrid") {
      await this.sendViaSendGrid(recipient, subject, text, html);
      return;
    }
    if (this.provider === "resend") {
      await this.sendViaResend(recipient, subject, text, html);
      return;
    }
    if (!this.transporter) {
      if (process.env.NODE_ENV === "production") {
        throw new Error(
          "Email delivery is not configured. Set SENDGRID_API_KEY (or RESEND_API_KEY) and EMAIL_FROM, or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and SMTP_FROM.",
        );
      }
      console.log(
        `[Ashenfall DEV] ${subject} for ${recipient}: ${verificationCode}`,
      );
      return;
    }

    await this.transporter.sendMail({
      from: this.from,
      to: recipient,
      subject,
      text,
      html,
    });
  }

  private async sendViaSendGrid(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): Promise<void> {
    const sender = parseSender(this.from);
    const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.sendGridKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: sender.name
          ? { email: sender.email, name: sender.name }
          : { email: sender.email },
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
      }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok)
      throw new Error(await describeHttpFailure("SendGrid", response));
  }

  private async sendViaResend(
    to: string,
    subject: string,
    text: string,
    html: string,
  ): Promise<void> {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from: this.from, to: [to], subject, text, html }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!response.ok)
      throw new Error(await describeHttpFailure("Resend", response));
  }

  private renderCodeEmail(instruction: string, code: string): string {
    const escapedInstruction = escapeHtml(instruction);
    const escapedCode = escapeHtml(code);
    return `<div style="font-family:Arial,sans-serif;background:#0b0910;color:#eee;padding:32px"><div style="max-width:560px;margin:auto;background:#15101b;border:1px solid #4b3c4f;border-radius:16px;padding:28px"><h1 style="color:#e7c77b">Ashenfall</h1><p>${escapedInstruction}</p><div style="font-size:36px;letter-spacing:10px;font-weight:800;color:#fff;background:#0d0a11;border:1px solid #665238;border-radius:12px;padding:18px;text-align:center">${escapedCode}</div><p style="color:#aaa">This code expires in ${CODE_EXPIRY_MINUTES} minutes.</p></div></div>`;
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>'"]/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "'": "&#39;",
        '"': "&quot;",
      })[character] || character,
  );
}
