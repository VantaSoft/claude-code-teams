import { google, gmail_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export class GmailClient {
  private gmail: gmail_v1.Gmail;

  constructor(auth: OAuth2Client) {
    this.gmail = google.gmail({ version: "v1", auth });
  }

  async markAsSpam(messageId: string): Promise<string> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
    });
    return `Message ${messageId} marked as spam.`;
  }

  async markAsNotSpam(messageId: string): Promise<string> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
    });
    return `Message ${messageId} moved to inbox.`;
  }

  async applyLabel(messageId: string, labelId: string): Promise<string> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { addLabelIds: [labelId] },
    });
    return `Label ${labelId} applied to message ${messageId}.`;
  }

  async removeLabel(messageId: string, labelId: string): Promise<string> {
    await this.gmail.users.messages.modify({
      userId: "me",
      id: messageId,
      requestBody: { removeLabelIds: [labelId] },
    });
    return `Label ${labelId} removed from message ${messageId}.`;
  }

  async listLabels(): Promise<gmail_v1.Schema$Label[]> {
    const res = await this.gmail.users.labels.list({ userId: "me" });
    return res.data.labels || [];
  }

  async searchMessages(query: string, maxResults: number = 10): Promise<gmail_v1.Schema$Message[]> {
    const res = await this.gmail.users.messages.list({ userId: "me", q: query, maxResults });
    if (!res.data.messages) return [];

    const messages = await Promise.all(
      res.data.messages.map((m) =>
        this.gmail.users.messages.get({ userId: "me", id: m.id!, format: "metadata", metadataHeaders: ["From", "Subject", "Date"] })
      )
    );
    return messages.map((m) => m.data);
  }

  async trash(messageId: string): Promise<string> {
    await this.gmail.users.messages.trash({ userId: "me", id: messageId });
    return `Message ${messageId} trashed.`;
  }

  async untrash(messageId: string): Promise<string> {
    await this.gmail.users.messages.untrash({ userId: "me", id: messageId });
    return `Message ${messageId} untrashed.`;
  }

  async sendEmail(to: string, subject: string, body: string, options?: { cc?: string; bcc?: string; threadId?: string; inReplyTo?: string }): Promise<{ id: string; threadId: string }> {
    const lines = [
      `To: ${to}`,
      `Subject: ${subject}`,
    ];
    if (options?.cc) lines.push(`Cc: ${options.cc}`);
    if (options?.bcc) lines.push(`Bcc: ${options.bcc}`);
    if (options?.inReplyTo) {
      lines.push(`In-Reply-To: ${options.inReplyTo}`);
      lines.push(`References: ${options.inReplyTo}`);
    }
    lines.push("Content-Type: text/plain; charset=utf-8");
    lines.push("");
    lines.push(body);

    const raw = Buffer.from(lines.join("\r\n")).toString("base64url");

    const res = await this.gmail.users.messages.send({
      userId: "me",
      requestBody: { raw, threadId: options?.threadId },
    });
    return { id: res.data.id!, threadId: res.data.threadId! };
  }

  async replyToMessage(messageId: string, body: string, options?: { cc?: string; bcc?: string }): Promise<{ id: string; threadId: string }> {
    // Get the original message to extract headers
    const original = await this.gmail.users.messages.get({ userId: "me", id: messageId, format: "metadata", metadataHeaders: ["From", "To", "Cc", "Subject", "Message-ID"] });
    const headers = original.data.payload?.headers || [];
    const from = headers.find((h) => h.name === "From")?.value || "";
    const subject = headers.find((h) => h.name === "Subject")?.value || "";
    const msgId = headers.find((h) => h.name === "Message-ID")?.value;
    const reSubject = subject.startsWith("Re: ") ? subject : `Re: ${subject}`;

    return this.sendEmail(from, reSubject, body, {
      cc: options?.cc,
      bcc: options?.bcc,
      threadId: original.data.threadId!,
      inReplyTo: msgId || undefined,
    });
  }

  async batchMarkAsSpam(messageIds: string[]): Promise<string> {
    await this.gmail.users.messages.batchModify({
      userId: "me",
      requestBody: { ids: messageIds, addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
    });
    return `${messageIds.length} messages marked as spam.`;
  }
}
