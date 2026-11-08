#!/usr/bin/env python3
"""Capture and scrub VTODO resources from a CalDAV collection (issue #244).

Used to build the client fixtures requested in PR #251 review: the same
recurring VTODO, before and after a client completes one occurrence.

Usage:
  CALDAV_USER=me CALDAV_PASS=app-password \\
  scripts/capture-ics.py <collection-url> <out-dir>

  e.g. scripts/capture-ics.py https://dav.example.com/calendars/me/tasks/ \\
       fixtures/tasks-org/weekly-before

Each VTODO resource is written as <out-dir>/<n>.ics after scrubbing:
  - UIDs are replaced by stable fakes (uid-1, uid-2, ...), consistently
    across RELATED-TO and across before/after runs that share an out root.
  - ORGANIZER/ATTENDEE/CONTACT/URL/ATTACH/GEO/LOCATION and X-*-EMAIL lines dropped.
  - SUMMARY/DESCRIPTION replaced unless they start with "fixture:".
PRODID, RRULE, EXDATE, RECURRENCE-ID, dates, STATUS etc. are kept verbatim,
since those are what the fixtures are for. Review the output before sharing.
"""
import base64
import json
import os
import re
import sys
import urllib.request
import xml.etree.ElementTree as ET

REPORT_BODY = b"""<?xml version="1.0" encoding="utf-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>
  <c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter>
</c:calendar-query>"""

NS = {"d": "DAV:", "c": "urn:ietf:params:xml:ns:caldav"}
DROP = re.compile(
    r"^(ORGANIZER|ATTENDEE|CONTACT|URL|ATTACH|GEO|LOCATION|X-[A-Z0-9-]*EMAIL)[;:]", re.I
)
UID_LINE = re.compile(r"^(UID|RELATED-TO)((?:;[^:]*)?:)(.*)$", re.I)
TEXT_LINE = re.compile(r"^(SUMMARY|DESCRIPTION)((?:;[^:]*)?:)(.*)$", re.I)


def unfold(text):
    return re.sub(r"\r?\n[ \t]", "", text).replace("\r\n", "\n").split("\n")


def fold(line):
    out, b = [], line.encode()
    while len(b) > 75:
        cut = 75
        while cut and (b[cut] & 0xC0) == 0x80:  # don't split UTF-8 sequences
            cut -= 1
        out.append(b[:cut].decode())
        b = b" " + b[cut:]
    out.append(b.decode())
    return "\r\n".join(out)


def scrub(text, uid_map):
    lines = []
    for line in unfold(text):
        if not line or DROP.match(line):
            continue
        m = UID_LINE.match(line)
        if m:
            real = m.group(3).strip()
            fake = uid_map.setdefault(real, f"uid-{len(uid_map) + 1}")
            line = f"{m.group(1)}{m.group(2)}{fake}"
        m = TEXT_LINE.match(line)
        if m and not m.group(3).lower().startswith("fixture:"):
            line = f"{m.group(1)}:redacted"
        lines.append(fold(line))
    return "\r\n".join(lines) + "\r\n"


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    url, out_dir = sys.argv[1], sys.argv[2]
    user, pw = os.environ.get("CALDAV_USER"), os.environ.get("CALDAV_PASS")
    if not (user and pw):
        sys.exit("Set CALDAV_USER and CALDAV_PASS")

    req = urllib.request.Request(url, data=REPORT_BODY, method="REPORT")
    req.add_header("Depth", "1")
    req.add_header("Content-Type", "application/xml; charset=utf-8")
    req.add_header("Authorization", "Basic " + base64.b64encode(f"{user}:{pw}".encode()).decode())
    with urllib.request.urlopen(req) as resp:
        tree = ET.fromstring(resp.read())

    # The UID map lives next to the out dir so before/after captures share fakes.
    os.makedirs(out_dir, exist_ok=True)
    map_path = os.path.join(os.path.dirname(os.path.abspath(out_dir)), ".uid-map.json")
    uid_map = json.load(open(map_path)) if os.path.exists(map_path) else {}

    resources = []
    for r in tree.findall("d:response", NS):
        data = r.find(".//c:calendar-data", NS)
        if data is not None and data.text and "BEGIN:VTODO" in data.text:
            resources.append(data.text)

    # Sort by first scrubbed UID for stable filenames across runs.
    scrubbed = sorted(scrub(t, uid_map) for t in resources)
    for i, body in enumerate(scrubbed, 1):
        with open(os.path.join(out_dir, f"{i}.ics"), "w", newline="") as f:
            f.write(body)
    json.dump(uid_map, open(map_path, "w"), indent=1)
    os.chmod(map_path, 0o600)  # maps real UIDs; never commit this file
    print(f"Wrote {len(scrubbed)} VTODO resource(s) to {out_dir}")
    print(f"NOTE: {map_path} contains real UIDs; do not share or commit it.")


if __name__ == "__main__":
    main()
