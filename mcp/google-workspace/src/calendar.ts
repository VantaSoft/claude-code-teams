import { google, calendar_v3 } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

export class CalendarClient {
  private calendar: calendar_v3.Calendar;

  constructor(auth: OAuth2Client) {
    this.calendar = google.calendar({ version: "v3", auth });
  }

  async listCalendars(): Promise<calendar_v3.Schema$CalendarListEntry[]> {
    const res = await this.calendar.calendarList.list();
    return res.data.items || [];
  }

  async listEvents(calendarId: string, timeMin?: string, timeMax?: string, maxResults: number = 10): Promise<calendar_v3.Schema$Event[]> {
    const params: calendar_v3.Params$Resource$Events$List = {
      calendarId,
      maxResults,
      singleEvents: true,
      orderBy: "startTime",
    };
    if (timeMin) params.timeMin = timeMin;
    if (timeMax) params.timeMax = timeMax;

    const res = await this.calendar.events.list(params);
    return res.data.items || [];
  }

  async createEvent(calendarId: string, event: {
    summary: string;
    description?: string;
    location?: string;
    start: string;
    end: string;
    attendees?: string[];
    timeZone?: string;
  }): Promise<calendar_v3.Schema$Event> {
    const tz = event.timeZone || "America/Los_Angeles";
    const res = await this.calendar.events.insert({
      calendarId,
      requestBody: {
        summary: event.summary,
        description: event.description,
        location: event.location,
        start: { dateTime: event.start, timeZone: tz },
        end: { dateTime: event.end, timeZone: tz },
        attendees: event.attendees?.map((email) => ({ email })),
      },
    });
    return res.data;
  }

  async updateEvent(calendarId: string, eventId: string, updates: {
    summary?: string;
    description?: string;
    location?: string;
    start?: string;
    end?: string;
    timeZone?: string;
  }): Promise<calendar_v3.Schema$Event> {
    const tz = updates.timeZone || "America/Los_Angeles";
    const body: calendar_v3.Schema$Event = {};
    if (updates.summary) body.summary = updates.summary;
    if (updates.description !== undefined) body.description = updates.description;
    if (updates.location !== undefined) body.location = updates.location;
    if (updates.start) body.start = { dateTime: updates.start, timeZone: tz };
    if (updates.end) body.end = { dateTime: updates.end, timeZone: tz };

    const res = await this.calendar.events.patch({
      calendarId,
      eventId,
      requestBody: body,
    });
    return res.data;
  }

  async deleteEvent(calendarId: string, eventId: string): Promise<string> {
    await this.calendar.events.delete({ calendarId, eventId });
    return `Event ${eventId} deleted.`;
  }

  async getFreeBusy(calendarIds: string[], timeMin: string, timeMax: string): Promise<calendar_v3.Schema$FreeBusyResponse> {
    const res = await this.calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        items: calendarIds.map((id) => ({ id })),
      },
    });
    return res.data;
  }
}
