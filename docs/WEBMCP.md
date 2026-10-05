# Experimental browser AI access

Enable **Settings → Data → Browser AI Access (Experimental)** to expose
Calino tools to a WebMCP-capable browser agent. Consent is off by default and
stored only in this browser, separately from synced settings. Disabling it
revokes access. Tools exist while a calendar page is open and unregister when
leaving it, including when opening Settings.

The browser must provide `document.modelContext.registerTool()` (or the earlier
`navigator.modelContext.registerTool()`) in a secure context. Unsupported
browsers continue to work normally. This integration is
web-only; it does not register tools in the Capacitor app or the background-sync
entry. No polyfill, AI SDK, agent credentials, or additional Calino server is
required. Calendar results may be sent to the browser agent's AI provider.

| Tool | Input | Result |
| --- | --- | --- |
| `list_calendars` | `{}` | Local calendar IDs, names, visibility, and whether event creation is supported |
| `search_events` | `start`, `end`; optional `query`, `calendarId`, `limit` | Compact summaries of visible events, including recurring occurrences |
| `open_event` | `eventId` | Opens an existing event in the normal editor |
| `prepare_event` | `title`, `start`, `end`; optional `allDay`, `calendarId`, `location` | Opens a draft; the user must save it |

Search dates are inclusive `YYYY-MM-DD` dates in the device timezone, limited to
31 calendar days. Search respects calendar visibility and category filters and
matches literal title/location text. Results default to 20, allow at most 50,
and include a `truncated` flag. Data is locally cached; tools do not trigger
sync. Timed results carry the event's timezone when applicable. UTC timestamps
retain their `Z`; naive timestamps use the accompanying timezone. All-day
events use calendar dates and Calino's inclusive end-date convention.

Draft times must be `YYYY-MM-DDTHH:mm` in the device timezone. Set `allDay: true`
and use date-only inputs for all-day events, with an inclusive last date. The
selected calendar must be writable and support `VEVENT`. Tools do not replace
an already-open event or journal form. Generated occurrence IDs are accepted by
`open_event` and use Calino's existing recurrence editor.

No tool creates, updates, deletes, syncs, or sends invitations. Search excludes
tasks and journals; tools do not return event descriptions, contacts,
attachments, raw iCalendar data, DAV URLs, or credentials. Calendar names and
event content are marked as untrusted output; read tools have `readOnlyHint`.
No cross-origin exposure is configured. Arguments are validated at runtime.

## Try it locally

Follow the [Chrome WebMCP setup guide](https://developer.chrome.com/docs/ai/webmcp)
to enable the testing flag or an origin trial. Run `pnpm dev`, opt in in Data
settings, and return to the calendar. Use Chrome's Model Context Tool Inspector
to inspect or invoke the four tools. For example:

```json
{"title":"Lunch","start":"2026-10-06T12:00","end":"2026-10-06T13:00","location":"Cafe"}
```

Invoking `prepare_event` opens the form without persisting an event. Cancel it
or review and save it normally. Turn access off in Settings to revoke consent.

`pnpm test:e2e e2e/webmcp.spec.ts` verifies the user flows with a browser API
fixture, including browsers without native WebMCP. A separate Chromium test
enables the experimental browser API and verifies real discovery, invocation,
schema registration, and cleanup. End-to-end behavior with an AI agent still
requires testing with that agent.

If Brave shows the testing flag as **Default (Enabled)** but the page still
reports the API as unavailable, choose **Enabled** explicitly and relaunch.
Verify that `typeof document.modelContext?.registerTool` is `"function"` in the
page's console. Explicitly launching Brave with
`--enable-features=WebMCPTesting` also enables the API in development. If you
already use `--enable-features`, add it to the existing comma-separated list.
