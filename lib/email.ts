import { createLogger } from "@/lib/logger";

const log = createLogger("email");

interface SmtpConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string;
  fromName: string;
}

function getConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM || user || "";

  if (!host || !user || !pass) return null;
  return { host, port, user, pass, from, fromName: process.env.SMTP_FROM_NAME || "Shortify AI" };
}

/**
 * Send email via SMTP using Node.js built-in net/tls modules.
 * Supports STARTTLS (port 587) and direct TLS (port 465).
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  if (process.env.NODE_ENV === "development" && !process.env.SMTP_HOST) {
    log.info(`[DEV] Email to ${to}: ${subject}`);
    return true;
  }

  const cfg = getConfig();
  if (!cfg) {
    log.warn(`SMTP not configured, skipping email to ${to}`);
    return false;
  }

  try {
    await smtpSend(cfg, to, subject, html);
    log.info(`Email sent to ${to}: ${subject}`);
    return true;
  } catch (err) {
    log.error(`Failed to send email to ${to}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function smtpSend(cfg: SmtpConfig, to: string, subject: string, html: string): Promise<void> {
  const { connect } = await import("tls");
  const { createConnection } = await import("net");

  const useTls = cfg.port === 465;
  const socket = useTls
    ? connect(cfg.port, cfg.host, { servername: cfg.host })
    : createConnection(cfg.port, cfg.host);

  return new Promise((resolve, reject) => {
    let buffer = "";
    let step = 0;

    function send(line: string) {
      socket.write(line + "\r\n");
    }

    function expect(code: string, cb: () => void) {
      buffer = "";
      const handler = (chunk: Buffer) => {
        buffer += chunk.toString();
        if (buffer.includes("\r\n")) {
          const lines = buffer.split("\r\n").filter(Boolean);
          const lastLine = lines[lines.length - 1];
          if (lastLine.startsWith(code)) {
            socket.off("data", handler);
            cb();
          } else if (lastLine.match(/^[45]\d\d/)) {
            socket.off("data", handler);
            reject(new Error(`SMTP ${lastLine}`));
            socket.end();
          }
        }
      };
      socket.on("data", handler);
    }

    const timeout = setTimeout(() => {
      reject(new Error("SMTP connection timeout"));
      socket.end();
    }, 15000);

    const b64 = (s: string) => Buffer.from(s).toString("base64");

    // Connection established → expect 220
    expect("220", () => {
      send(`EHLO ${cfg.host}`);
      // EHLO response → AUTH
      expect("250", () => {
        send("AUTH LOGIN");
        expect("334", () => {
          send(b64(cfg.user));
          expect("334", () => {
            send(b64(cfg.pass));
            expect("235", () => {
              send(`MAIL FROM: <${cfg.from}>`);
              expect("250", () => {
                send(`RCPT TO: <${to}>`);
                expect("250", () => {
                  send("DATA");
                  expect("354", () => {
                    const headers = [
                      `From: "${cfg.fromName}" <${cfg.from}>`,
                      `To: <${to}>`,
                      `Subject: ${subject}`,
                      "MIME-Version: 1.0",
                      "Content-Type: text/html; charset=utf-8",
                      "Content-Transfer-Encoding: 7bit",
                      "",
                      html,
                    ].join("\r\n");
                    send(headers);
                    send(".");
                    expect("250", () => {
                      send("QUIT");
                      clearTimeout(timeout);
                      socket.end();
                      resolve();
                    });
                  });
                });
              });
            });
          });
        });
      });
    });

    socket.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

function buildEmailLayout(title: string, name: string, buttonText: string, buttonUrl: string, note: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,sans-serif;background:#0a0a0a;color:#e4e4e7;padding:40px 20px">
  <div style="max-width:480px;margin:0 auto;background:#18181b;border-radius:12px;padding:32px;border:1px solid #27272a">
    <h2 style="color:#fafafa;margin-top:0">${title}</h2>
    <p style="color:#a1a1aa;line-height:1.6">你好 ${name}，</p>
    <div style="text-align:center;margin:28px 0">
      <a href="${buttonUrl}"
         style="display:inline-block;background:#059669;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px">
        ${buttonText}
      </a>
    </div>
    <p style="color:#71717a;font-size:13px;line-height:1.5">
      或复制链接到浏览器：<br>
      <span style="color:#34d399;word-break:break-all">${buttonUrl}</span>
    </p>
    <p style="color:#71717a;font-size:13px">${note}</p>
    <hr style="border:none;border-top:1px solid #27272a;margin:24px 0">
    <p style="color:#52525b;font-size:12px">Shortify AI - AI 短剧创作平台</p>
  </div>
</body>
</html>`;
}

export function buildVerifyEmailHtml(name: string, token: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return buildEmailLayout(
    "验证邮箱地址",
    name,
    "验证邮箱",
    `${baseUrl}/verify-email?token=${encodeURIComponent(token)}`,
    "该链接 24 小时内有效。如果你没有注册 Shortify AI，请忽略此邮件。"
  );
}

export function buildResetEmailHtml(name: string, token: string): string {
  const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  return buildEmailLayout(
    "重置密码",
    name,
    "重置密码",
    `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`,
    "该链接 1 小时内有效。如果不是你本人操作，请忽略此邮件。"
  );
}
