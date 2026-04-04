#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getAuthClient, isConfigured, getConfigDir, listAccounts } from "./auth.js";
import { GmailClient } from "./gmail.js";
import { CalendarClient } from "./calendar.js";
import { DriveClient } from "./drive.js";

const server = new McpServer({
  name: "google-workspace",
  version: "1.1.0",
});

async function getClients(account: string = "default") {
  const auth = await getAuthClient(account);
  return {
    gmail: new GmailClient(auth),
    calendar: new CalendarClient(auth),
    drive: new DriveClient(auth),
  };
}

const accountParam = z.string().optional().default("default").describe("Account name (default, work, personal, etc.). Use gw_list_accounts to see available accounts.");

// --- Status ---

server.tool("gw_status", "Check which Google Workspace accounts are configured", {}, async () => {
  const accounts = listAccounts();
  if (accounts.length === 0) {
    return { content: [{ type: "text", text: `No accounts configured.\nConfig dir: ${getConfigDir()}\nPlace credentials.json and run setup.` }] };
  }
  const text = `Configured accounts: ${accounts.join(", ")}\nConfig dir: ${getConfigDir()}`;
  return { content: [{ type: "text", text }] };
});

server.tool("gw_list_accounts", "List all configured Google Workspace accounts", {}, async () => {
  const accounts = listAccounts();
  if (accounts.length === 0) return { content: [{ type: "text", text: "No accounts configured." }] };
  return { content: [{ type: "text", text: accounts.join("\n") }] };
});

// ============================================================
// GMAIL TOOLS
// ============================================================

server.tool(
  "gmail_mark_as_spam",
  "Mark a Gmail message as spam (moves it out of inbox)",
  { messageId: z.string().describe("The Gmail message ID"), account: accountParam },
  async ({ messageId, account }) => {
    const { gmail } = await getClients(account);
    return { content: [{ type: "text", text: await gmail.markAsSpam(messageId) }] };
  }
);

server.tool(
  "gmail_mark_not_spam",
  "Move a Gmail message from spam back to inbox",
  { messageId: z.string().describe("The Gmail message ID"), account: accountParam },
  async ({ messageId, account }) => {
    const { gmail } = await getClients(account);
    return { content: [{ type: "text", text: await gmail.markAsNotSpam(messageId) }] };
  }
);

server.tool(
  "gmail_batch_mark_spam",
  "Mark multiple Gmail messages as spam at once",
  { messageIds: z.array(z.string()).describe("Array of Gmail message IDs"), account: accountParam },
  async ({ messageIds, account }) => {
    const { gmail } = await getClients(account);
    return { content: [{ type: "text", text: await gmail.batchMarkAsSpam(messageIds) }] };
  }
);

server.tool(
  "gmail_apply_label",
  "Apply a label to a Gmail message",
  {
    messageId: z.string().describe("The Gmail message ID"),
    labelId: z.string().describe("The Gmail label ID (use gmail_list_labels to find IDs)"),
    account: accountParam,
  },
  async ({ messageId, labelId, account }) => {
    const { gmail } = await getClients(account);
    return { content: [{ type: "text", text: await gmail.applyLabel(messageId, labelId) }] };
  }
);

server.tool(
  "gmail_remove_label",
  "Remove a label from a Gmail message",
  {
    messageId: z.string().describe("The Gmail message ID"),
    labelId: z.string().describe("The Gmail label ID"),
    account: accountParam,
  },
  async ({ messageId, labelId, account }) => {
    const { gmail } = await getClients(account);
    return { content: [{ type: "text", text: await gmail.removeLabel(messageId, labelId) }] };
  }
);

server.tool(
  "gmail_trash",
  "Move a Gmail message to trash",
  { messageId: z.string().describe("The Gmail message ID"), account: accountParam },
  async ({ messageId, account }) => {
    const { gmail } = await getClients(account);
    return { content: [{ type: "text", text: await gmail.trash(messageId) }] };
  }
);

server.tool(
  "gmail_untrash",
  "Restore a Gmail message from trash",
  { messageId: z.string().describe("The Gmail message ID"), account: accountParam },
  async ({ messageId, account }) => {
    const { gmail } = await getClients(account);
    return { content: [{ type: "text", text: await gmail.untrash(messageId) }] };
  }
);

server.tool(
  "gmail_list_labels",
  "List all Gmail labels with their IDs",
  { account: accountParam },
  async ({ account }) => {
    const { gmail } = await getClients(account);
    const labels = await gmail.listLabels();
    const text = labels.map((l) => `${l.name} (${l.id})`).join("\n");
    return { content: [{ type: "text", text: text || "No labels found." }] };
  }
);

server.tool(
  "gmail_search",
  "Search Gmail messages using Gmail query syntax",
  {
    query: z.string().describe("Gmail search query (e.g. 'from:user@example.com is:unread')"),
    maxResults: z.number().optional().default(10).describe("Max results to return"),
    account: accountParam,
  },
  async ({ query, maxResults, account }) => {
    const { gmail } = await getClients(account);
    const messages = await gmail.searchMessages(query, maxResults);
    if (messages.length === 0) return { content: [{ type: "text", text: "No messages found." }] };

    const text = messages.map((m) => {
      const headers = m.payload?.headers || [];
      const from = headers.find((h) => h.name === "From")?.value || "unknown";
      const subject = headers.find((h) => h.name === "Subject")?.value || "(no subject)";
      const date = headers.find((h) => h.name === "Date")?.value || "";
      return `ID: ${m.id}\n  From: ${from}\n  Subject: ${subject}\n  Date: ${date}`;
    }).join("\n\n");

    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "gmail_send",
  "Send an email",
  {
    to: z.string().describe("Recipient email (e.g. 'Name <email>' or just 'email')"),
    subject: z.string().describe("Email subject"),
    body: z.string().describe("Email body (plain text)"),
    cc: z.string().optional().describe("CC recipients (comma-separated)"),
    bcc: z.string().optional().describe("BCC recipients (comma-separated)"),
    account: accountParam,
  },
  async ({ to, subject, body, cc, bcc, account }) => {
    const { gmail } = await getClients(account);
    const result = await gmail.sendEmail(to, subject, body, { cc, bcc });
    return { content: [{ type: "text", text: `Email sent. ID: ${result.id}, Thread: ${result.threadId}` }] };
  }
);

server.tool(
  "gmail_reply",
  "Reply to an existing email message",
  {
    messageId: z.string().describe("The message ID to reply to"),
    body: z.string().describe("Reply body (plain text)"),
    cc: z.string().optional().describe("CC recipients (comma-separated)"),
    account: accountParam,
  },
  async ({ messageId, body, cc, account }) => {
    const { gmail } = await getClients(account);
    const result = await gmail.replyToMessage(messageId, body, { cc });
    return { content: [{ type: "text", text: `Reply sent. ID: ${result.id}, Thread: ${result.threadId}` }] };
  }
);

// ============================================================
// CALENDAR TOOLS
// ============================================================

server.tool(
  "gcal_list_calendars",
  "List all Google Calendars",
  { account: accountParam },
  async ({ account }) => {
    const { calendar } = await getClients(account);
    const cals = await calendar.listCalendars();
    const text = cals.map((c) => `${c.summary} (${c.id}) ${c.primary ? "[PRIMARY]" : ""}`).join("\n");
    return { content: [{ type: "text", text: text || "No calendars found." }] };
  }
);

server.tool(
  "gcal_list_events",
  "List upcoming events from a Google Calendar",
  {
    calendarId: z.string().optional().default("primary").describe("Calendar ID (default: primary)"),
    timeMin: z.string().optional().describe("Start time in ISO 8601 format"),
    timeMax: z.string().optional().describe("End time in ISO 8601 format"),
    maxResults: z.number().optional().default(10).describe("Max events to return"),
    account: accountParam,
  },
  async ({ calendarId, timeMin, timeMax, maxResults, account }) => {
    const { calendar } = await getClients(account);
    const events = await calendar.listEvents(calendarId, timeMin, timeMax, maxResults);
    if (events.length === 0) return { content: [{ type: "text", text: "No events found." }] };

    const text = events.map((e) => {
      const start = e.start?.dateTime || e.start?.date || "?";
      const end = e.end?.dateTime || e.end?.date || "?";
      return `ID: ${e.id}\n  Summary: ${e.summary || "(no title)"}\n  Start: ${start}\n  End: ${end}\n  Location: ${e.location || "none"}`;
    }).join("\n\n");

    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "gcal_create_event",
  "Create a new Google Calendar event",
  {
    summary: z.string().describe("Event title"),
    start: z.string().describe("Start time in ISO 8601 format (e.g. 2025-04-03T10:00:00-07:00)"),
    end: z.string().describe("End time in ISO 8601 format"),
    calendarId: z.string().optional().default("primary").describe("Calendar ID"),
    description: z.string().optional().describe("Event description"),
    location: z.string().optional().describe("Event location"),
    attendees: z.array(z.string()).optional().describe("Attendee email addresses"),
    timeZone: z.string().optional().default("America/Los_Angeles").describe("Time zone"),
    account: accountParam,
  },
  async ({ summary, start, end, calendarId, description, location, attendees, timeZone, account }) => {
    const { calendar } = await getClients(account);
    const event = await calendar.createEvent(calendarId, { summary, start, end, description, location, attendees, timeZone });
    return { content: [{ type: "text", text: `Event created: ${event.summary} (${event.id})\nLink: ${event.htmlLink}` }] };
  }
);

server.tool(
  "gcal_update_event",
  "Update an existing Google Calendar event",
  {
    eventId: z.string().describe("The event ID to update"),
    calendarId: z.string().optional().default("primary").describe("Calendar ID"),
    summary: z.string().optional().describe("New event title"),
    description: z.string().optional().describe("New event description"),
    location: z.string().optional().describe("New event location"),
    start: z.string().optional().describe("New start time in ISO 8601"),
    end: z.string().optional().describe("New end time in ISO 8601"),
    timeZone: z.string().optional().default("America/Los_Angeles").describe("Time zone"),
    account: accountParam,
  },
  async ({ eventId, calendarId, summary, description, location, start, end, timeZone, account }) => {
    const { calendar } = await getClients(account);
    const event = await calendar.updateEvent(calendarId, eventId, { summary, description, location, start, end, timeZone });
    return { content: [{ type: "text", text: `Event updated: ${event.summary} (${event.id})` }] };
  }
);

server.tool(
  "gcal_delete_event",
  "Delete a Google Calendar event",
  {
    eventId: z.string().describe("The event ID to delete"),
    calendarId: z.string().optional().default("primary").describe("Calendar ID"),
    account: accountParam,
  },
  async ({ eventId, calendarId, account }) => {
    const { calendar } = await getClients(account);
    const result = await calendar.deleteEvent(calendarId, eventId);
    return { content: [{ type: "text", text: result }] };
  }
);

server.tool(
  "gcal_free_busy",
  "Check free/busy status for calendars in a time range",
  {
    calendarIds: z.array(z.string()).optional().default(["primary"]).describe("Calendar IDs to check"),
    timeMin: z.string().describe("Start of range in ISO 8601"),
    timeMax: z.string().describe("End of range in ISO 8601"),
    account: accountParam,
  },
  async ({ calendarIds, timeMin, timeMax, account }) => {
    const { calendar } = await getClients(account);
    const data = await calendar.getFreeBusy(calendarIds, timeMin, timeMax);
    const text = Object.entries(data.calendars || {}).map(([cal, info]) => {
      const busy = (info as { busy?: Array<{ start?: string; end?: string }> }).busy || [];
      if (busy.length === 0) return `${cal}: Free`;
      const slots = busy.map((b) => `  ${b.start} - ${b.end}`).join("\n");
      return `${cal}: Busy\n${slots}`;
    }).join("\n\n");

    return { content: [{ type: "text", text: text || "No calendar data returned." }] };
  }
);

// ============================================================
// DRIVE TOOLS
// ============================================================

server.tool(
  "gdrive_search",
  "Search Google Drive files using Drive query syntax",
  {
    query: z.string().describe("Drive search query (e.g. \"name contains 'report'\" or \"mimeType='application/pdf'\")"),
    maxResults: z.number().optional().default(10).describe("Max results to return"),
    account: accountParam,
  },
  async ({ query, maxResults, account }) => {
    const { drive } = await getClients(account);
    const files = await drive.search(query, maxResults);
    if (files.length === 0) return { content: [{ type: "text", text: "No files found." }] };

    const text = files.map((f) =>
      `ID: ${f.id}\n  Name: ${f.name}\n  Type: ${f.mimeType}\n  Modified: ${f.modifiedTime}\n  Link: ${f.webViewLink}`
    ).join("\n\n");

    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "gdrive_read",
  "Read the content of a Google Drive file (works with Docs, Sheets, and text files)",
  { fileId: z.string().describe("The Drive file ID"), account: accountParam },
  async ({ fileId, account }) => {
    const { drive } = await getClients(account);
    const content = await drive.readFileContent(fileId);
    return { content: [{ type: "text", text: content }] };
  }
);

server.tool(
  "gdrive_get_info",
  "Get metadata about a Google Drive file",
  { fileId: z.string().describe("The Drive file ID"), account: accountParam },
  async ({ fileId, account }) => {
    const { drive } = await getClients(account);
    const file = await drive.getFile(fileId);
    const text = `Name: ${file.name}\nID: ${file.id}\nType: ${file.mimeType}\nModified: ${file.modifiedTime}\nSize: ${file.size || "N/A"}\nLink: ${file.webViewLink}`;
    return { content: [{ type: "text", text }] };
  }
);

server.tool(
  "gdrive_upload",
  "Upload a local file to Google Drive",
  {
    localPath: z.string().describe("Absolute path to the local file"),
    name: z.string().optional().describe("Name for the file in Drive (defaults to local filename)"),
    parentFolderId: z.string().optional().describe("Parent folder ID in Drive"),
    account: accountParam,
  },
  async ({ localPath, name, parentFolderId, account }) => {
    const { drive } = await getClients(account);
    const fileName = name || localPath.split("/").pop() || "upload";
    const file = await drive.uploadFile(fileName, localPath, parentFolderId);
    return { content: [{ type: "text", text: `Uploaded: ${file.name} (${file.id})\nLink: ${file.webViewLink}` }] };
  }
);

server.tool(
  "gdrive_create_folder",
  "Create a new folder in Google Drive",
  {
    name: z.string().describe("Folder name"),
    parentFolderId: z.string().optional().describe("Parent folder ID"),
    account: accountParam,
  },
  async ({ name, parentFolderId, account }) => {
    const { drive } = await getClients(account);
    const folder = await drive.createFolder(name, parentFolderId);
    return { content: [{ type: "text", text: `Folder created: ${folder.name} (${folder.id})\nLink: ${folder.webViewLink}` }] };
  }
);

server.tool(
  "gdrive_share",
  "Share a Google Drive file with someone",
  {
    fileId: z.string().describe("The Drive file ID"),
    email: z.string().describe("Email address to share with"),
    role: z.enum(["reader", "writer", "commenter"]).optional().default("reader").describe("Permission level"),
    account: accountParam,
  },
  async ({ fileId, email, role, account }) => {
    const { drive } = await getClients(account);
    return { content: [{ type: "text", text: await drive.shareFile(fileId, email, role) }] };
  }
);

server.tool(
  "gdrive_delete",
  "Delete a Google Drive file (permanent)",
  { fileId: z.string().describe("The Drive file ID"), account: accountParam },
  async ({ fileId, account }) => {
    const { drive } = await getClients(account);
    return { content: [{ type: "text", text: await drive.deleteFile(fileId) }] };
  }
);

server.tool(
  "gdrive_move",
  "Move a Google Drive file to a different folder",
  {
    fileId: z.string().describe("The Drive file ID"),
    newParentId: z.string().describe("The destination folder ID"),
    account: accountParam,
  },
  async ({ fileId, newParentId, account }) => {
    const { drive } = await getClients(account);
    return { content: [{ type: "text", text: await drive.moveFile(fileId, newParentId) }] };
  }
);

// --- Start ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Google Workspace MCP server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
