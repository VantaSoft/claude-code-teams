import { google, docs_v1 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export class DocsClient {
  private docs: docs_v1.Docs;

  constructor(auth: OAuth2Client) {
    this.docs = google.docs({ version: "v1", auth });
  }

  /**
   * Replace every occurrence of `findText` with `replaceText` in the document.
   * Case-sensitive. Uses the Docs API's replaceAllText request.
   */
  async replaceText(documentId: string, findText: string, replaceText: string, matchCase: boolean = true): Promise<number> {
    const res = await this.docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            replaceAllText: {
              containsText: { text: findText, matchCase },
              replaceText,
            },
          },
        ],
      },
    });
    const replies = res.data.replies || [];
    const reply = replies[0]?.replaceAllText;
    return reply?.occurrencesChanged || 0;
  }

  /**
   * Insert text at the end of the document (before the final trailing newline).
   */
  async appendText(documentId: string, text: string): Promise<void> {
    // Find the end index of the document body.
    const doc = await this.docs.documents.get({ documentId, fields: "body(content(endIndex))" });
    const content = doc.data.body?.content || [];
    const lastEl = content[content.length - 1];
    const endIndex = lastEl?.endIndex ?? 1;
    // Insert at endIndex - 1 (before the final newline that terminates the body).
    const insertIndex = Math.max(1, endIndex - 1);

    await this.docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index: insertIndex },
              text,
            },
          },
        ],
      },
    });
  }

  /**
   * Insert text at a specific character index in the document.
   * Index 1 = beginning of the body (index 0 is not valid in Docs).
   */
  async insertText(documentId: string, index: number, text: string): Promise<void> {
    await this.docs.documents.batchUpdate({
      documentId,
      requestBody: {
        requests: [
          {
            insertText: {
              location: { index },
              text,
            },
          },
        ],
      },
    });
  }

  /**
   * Run an arbitrary batch of Docs API requests. For callers that need inserts,
   * deletions, text replacements, and formatting changes applied atomically.
   * See https://developers.google.com/docs/api/reference/rest/v1/documents/request
   */
  async batchUpdate(documentId: string, requests: docs_v1.Schema$Request[]): Promise<docs_v1.Schema$BatchUpdateDocumentResponse> {
    const res = await this.docs.documents.batchUpdate({
      documentId,
      requestBody: { requests },
    });
    return res.data;
  }

  /**
   * Create a new blank Google Doc.
   */
  async createDoc(title: string): Promise<{ documentId: string; title: string }> {
    const res = await this.docs.documents.create({ requestBody: { title } });
    return {
      documentId: res.data.documentId || "",
      title: res.data.title || title,
    };
  }
}
