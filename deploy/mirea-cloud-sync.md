# MIREA cloud synchronization

The production backend script `scripts/sync_mirea_cloud.py` reads the two
organizer-provided public XLSX sources. `--actor-id` must reference an active
administrator. The default cohort is 8, accelerator 6, year 2026. Without
`--apply` the full transaction is rolled back after producing its report.

Install the adjacent `.service` and `.timer` files in `/etc/systemd/system/`,
run `systemctl daemon-reload`, then `systemctl enable --now
pitchy-mirea-cloud-sync.timer`. Execute the service once for the initial sync.
The timer checks every five minutes. Inspect `journalctl -u
pitchy-mirea-cloud-sync.service` and `systemctl list-timers` for results. Stop
the timer with `systemctl disable --now pitchy-mirea-cloud-sync.timer`.

The service uses the running backend's environment and deployed GitHub image;
it contains no credentials. PostgreSQL advisory locks prevent overlapping
runs. Event row locks serialize imports with manual attendance decisions and
correction reviews. Both sources must download and parse before any writes.
All changes commit in one transaction and trigger the existing cache/SSE
invalidation. A failed run rolls back and the next timer tick retries.

## Matching and precedence

- Events match by unique join URL, title plus date, or unique title plus
  speaker. Ambiguity aborts the transaction. Unknown titles create events;
  missing events are never deleted or cancelled. Blank source fields preserve
  existing descriptions, posters, links and speakers. An unnamed offline
  meeting with a date, time and speaker is named «Очное мероприятие».
- Attendance uses dates in column headers. Columns without dates and future
  meetings are skipped. When multiple meetings share a date, the number of
  date-labelled columns must equal the number of scheduled events that day;
  columns follow chronological event order. Same-time ambiguity is skipped.
- Project names are normalized for case, spaces and punctuation. The one
  historical rename for team 140 is explicitly mapped from the verified
  previous import. Unknown/ambiguous project names are reported and skipped;
  fuzzy matching is never used. Linked teams resolve to the attendance owner.
- Empty cells preserve marks. Multiple rows for one team aggregate presence
  with OR. Conflicting non-presence marks are skipped. The existing attendance
  service credits all current enrolled/completed team members.
- Organizer-approved correction requests and marks outside the known workbook
  imports take precedence, including QR scans and manual decisions. An
  organizer decision can therefore disagree with the workbook without being
  reverted at the next import.
- Existing reporting denominators and team exemptions remain intact. Newly
  dated past meetings extend the policy event list; the planned denominator
  only increases if the list exceeds the current plan. «Ставрополь» remains
  an excused mark; the importer does not invent new team exemptions.

The report includes changes, protected decisions, unmatched projects, skipped
dates, undated headers, and future columns. An unchanged run creates no marks
or audit entries. It still checks current team rosters, so newly joined members
can receive the imported team credit.

## Verification

`tests/test_accelerator_mirea_cloud_sync.py` covers date parsing, undated and
empty cells, invalid values, event identity, ambiguous matching, preview
rollback, team propagation, idempotence and preservation of manual/approved
decisions. It is included in the accelerator backend test glob.
