import { google, drive_v3, sheets_v4 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";
import * as fs from "node:fs";
import * as path from "node:path";

export class DriveClient {
  private drive: drive_v3.Drive;
  private sheets: sheets_v4.Sheets;

  constructor(auth: OAuth2Client) {
    this.drive = google.drive({ version: "v3", auth });
    this.sheets = google.sheets({ version: "v4", auth });
  }

  async search(query: string, maxResults: number = 10): Promise<drive_v3.Schema$File[]> {
    const res = await this.drive.files.list({
      q: query,
      pageSize: maxResults,
      fields: "files(id,name,mimeType,modifiedTime,size,webViewLink,parents)",
      orderBy: "modifiedTime desc",
    });
    return res.data.files || [];
  }

  async getFile(fileId: string): Promise<drive_v3.Schema$File> {
    const res = await this.drive.files.get({
      fileId,
      fields: "id,name,mimeType,modifiedTime,size,webViewLink,parents,description",
    });
    return res.data;
  }

  async readFileContent(fileId: string, sheetName?: string): Promise<string> {
    // For Google Docs/Sheets/Slides, export as text
    const meta = await this.getFile(fileId);
    const mimeType = meta.mimeType || "";

    if (mimeType === "application/vnd.google-apps.document") {
      const res = await this.drive.files.export({ fileId, mimeType: "text/plain" }, { responseType: "text" });
      return res.data as string;
    } else if (mimeType === "application/vnd.google-apps.spreadsheet") {
      if (sheetName) {
        // Use Sheets API to read a specific tab
        const res = await this.sheets.spreadsheets.values.get({
          spreadsheetId: fileId,
          range: sheetName,
        });
        const rows = res.data.values || [];
        return rows.map((row) => row.join(",")).join("\n");
      }
      // Default: export first sheet as CSV via Drive API
      const res = await this.drive.files.export({ fileId, mimeType: "text/csv" }, { responseType: "text" });
      return res.data as string;
    } else {
      // Refuse binary blobs — decoding random bytes as UTF-8 corrupts
      // them. Only text-ish MIME types are readable here; callers who
      // need binary should use driveFileId via the attachment path.
      const isTextish =
        mimeType.startsWith("text/") ||
        mimeType === "application/json" ||
        mimeType === "application/xml" ||
        mimeType === "application/yaml" ||
        mimeType.endsWith("+json") ||
        mimeType.endsWith("+xml");
      if (!isTextish) {
        throw new Error(
          `Cannot read binary file (mimeType=${mimeType}). Use gdrive_upload, driveFileId attachment, or export via Google-native handlers.`
        );
      }
      const res = await this.drive.files.get({ fileId, alt: "media" }, { responseType: "text" });
      return res.data as string;
    }
  }

  async listSheets(fileId: string): Promise<string[]> {
    const res = await this.sheets.spreadsheets.get({
      spreadsheetId: fileId,
      fields: "sheets.properties.title",
    });
    return (res.data.sheets || []).map((s) => s.properties?.title || "");
  }

  async uploadFile(name: string, localPath: string, parentFolderId?: string, mimeType?: string): Promise<drive_v3.Schema$File> {
    const media = { body: fs.createReadStream(localPath) };
    const requestBody: drive_v3.Schema$File = { name };
    if (parentFolderId) requestBody.parents = [parentFolderId];
    if (mimeType) requestBody.mimeType = mimeType;

    const res = await this.drive.files.create({
      requestBody,
      media,
      fields: "id,name,webViewLink",
    });
    return res.data;
  }

  async createFolder(name: string, parentFolderId?: string): Promise<drive_v3.Schema$File> {
    const requestBody: drive_v3.Schema$File = {
      name,
      mimeType: "application/vnd.google-apps.folder",
    };
    if (parentFolderId) requestBody.parents = [parentFolderId];

    const res = await this.drive.files.create({
      requestBody,
      fields: "id,name,webViewLink",
    });
    return res.data;
  }

  async shareFile(fileId: string, email: string, role: "reader" | "writer" | "commenter" = "reader"): Promise<string> {
    await this.drive.permissions.create({
      fileId,
      requestBody: {
        type: "user",
        role,
        emailAddress: email,
      },
    });
    return `Shared ${fileId} with ${email} as ${role}.`;
  }

  async deleteFile(fileId: string): Promise<string> {
    await this.drive.files.delete({ fileId });
    return `File ${fileId} deleted.`;
  }

  async moveFile(fileId: string, newParentId: string): Promise<string> {
    const file = await this.drive.files.get({ fileId, fields: "parents" });
    const previousParents = (file.data.parents || []).join(",");

    await this.drive.files.update({
      fileId,
      addParents: newParentId,
      removeParents: previousParents,
      fields: "id,parents",
    });
    return `File ${fileId} moved to folder ${newParentId}.`;
  }
}
