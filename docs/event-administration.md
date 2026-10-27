# Shared administration and event workspaces

`/admin/` is shared SDLCAI administration. SDLCAI news at
`/admin/newsletter/` manages the same subscribers, consent evidence, withdrawals
and Mailrelay state from every event context. Selecting an event opens
`/events/<event-id>/admin/`. The event label remains visible in navigation.
Only explicitly provisioned events in `EVENT_WORKSPACES` appear in the selector;
production currently contains **SDLCAI 2026** only.

## Isolation and compatibility

Each event owns a D1 database and its upload, export and backup R2 bindings.
The Worker constructs a fresh environment for each request or scheduled job;
handlers receive only that event's database and buckets. Binding names must be
distinct between events. The `event_dataset` ownership row must also match the
selected event, preventing two differently named D1 bindings from accidentally
opening the same dataset. Missing bindings, unknown events and mismatched
ownership fail closed.

The existing database remains the 2026 dataset. It also retains the shared
newsletter tables to avoid moving consent history or invalidating subscriptions.
Newsletter handlers, cleanup, provider sync and backups explicitly use the
original shared environment. Future event schemas contain no newsletter tables.
Creating a registration never creates marketing consent.

Existing `/admin/<tool>/`, `/api/admin/<tool>`, speaker, staff, feedback and
published media links remain attached to **2026**. `/admin/` now opens the shared
desk. Explicit event requests use `/events/<id>/<existing-path>`; for example,
`/events/2026/api/admin/attendees`. Shared newsletter and sign-in/out routes keep
their existing paths. Sign-in returns to the requested event workspace.
Selection never changes a global cookie: two tabs can safely work on different
events. Event staff/session cookies have edition-specific names for new events;
existing 2026 cookies remain valid. Staff tokens are looked up only in their own
database. Stateless event-message preview and unsubscribe signatures also bind
the event ID; shared news confirmation and unsubscribe signatures stay shared.

## Scope inventory

| Scope                            | Workspaces, APIs and tables                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared news                      | `/admin/newsletter/`, `/api/admin/newsletter*`, `/api/newsletter/*`, `/subscribe/*`; `newsletter_subscribers`, `newsletter_consent_events`, `newsletter_signup_limits`, `newsletter_mailrelay_sync`, `newsletter_mailrelay_control`.                                                                                                                                                                                  |
| Shared services                  | Admin username/password and session, encryption service key, sender identity, Turnstile, Browser Rendering, Images and Stream account bindings. These do not grant a speaker or staff member access to another event.                                                                                                                                                                                                 |
| Event identity and programme     | `event_dataset`, `canonical_speaker_content`, `schedule_order`, `organizers`. Speaker profiles and organizer entries are event participation records; no automatic global identity merge or copying is performed.                                                                                                                                                                                                     |
| Event speaker access and content | `speaker_contacts`, `speaker_workspace_access`, `speaker_workspace_sessions`, `speaker_login_requests`, `speaker_magic_links`, `speaker_content_revisions`, `speaker_photo_revisions`, `speaker_video_submissions`, `speaker_presentation_responses`, `speaker_slides`, `speaker_slide_links`, `speaker_slide_garbage`, `speaker_recording_links`. All speaker/admin/media API handlers use the selected environment. |
| Event hospitality                | `speaker_dinner_responses`, `speaker_dinner_shared_invites`, `speaker_dinner_shared_responses`, `speaker_dinner_catering`, `speaker_receipt_access`, `speaker_travel_receipts`. “Shared dinner invite” means shared within that event, not across events.                                                                                                                                                             |
| Event registration and badges    | `attendee_roster`, `attendee_arrivals`, `attendee_arrival_events`, `registration_access_grants`, `registration_staff_sessions`, `badge_workspace`, `volunteers`; attendee, catering, registration and badge APIs and exports.                                                                                                                                                                                         |
| Event communication and review   | `speaker_email_campaigns`, `speaker_email_deliveries`, `speaker_review_digests`, `speaker_review_tokens`, `organizer_digests`, `organizer_data_changes`, `attendee_message_preferences`, `attendee_message_draft`, `attendee_message_campaigns`, `attendee_message_deliveries`. Recipient reads, previews, retries and suppression apply only to that event.                                                          |
| Event research and production    | `interests`, `poster_proposals`, `event_photo_reviews`, `visitor_feedback`, `visitor_feedback_totals`, `publication_queue`, `activity_events`; interests, posters, photos, feedback, publication and activity APIs, CSVs and downloads. The interest list's original registration-opening purpose is preserved; it is not migrated into marketing subscriptions.                                                      |
| Event Q&A                        | `qa_rooms`, `qa_settings`, `qa_access_grants`, `qa_staff_sessions`; Durable Object rooms, login throttle and update hub use `sdlcai-<event-id>:<name>`. Existing 2026 object names stay unchanged.                                                                                                                                                                                                                    |
| Event assets and saved state     | Hospitality, photographs, posters, slides, signs, talk previews, graphics and post-production libraries belong to their edition. Public brand fonts/logos can be reused. Browser inventory/music shortlists and announcement drafts use `sdlcai-<id>-…` keys. The earlier 2026 announcement draft is migrated on first use; existing 2026 inventory/music keys stay valid. Theme preference stays shared.             |
| Schema bookkeeping               | Each database owns its `d1_migrations` ledger. Future bootstrap schemas record the current baseline so historical 2026 data seeds are never replayed.                                                                                                                                                                                                                                                                 |

## Storage, backups and scheduled work

2026 retains all original bucket names, object keys, published URLs and media
permissions. New events require separate buckets; reuse of a public media asset
must be deliberate. A database row from one event must never be moved without
its corresponding private objects and permission review.

| Binding or job         | Scope and policy                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SPEAKER_UPLOADS`      | Selected event's uploads bucket: existing photo, slide, receipt, intro and event-photo prefixes remain unchanged for 2026. Receipt/slide garbage collection uses only that event's rows and bucket.                                                                                                                      |
| `SOCIAL_EXPORTS`       | Selected event's rendered social exports and cache. 2026 render contracts and build manifests cannot be used as another edition's assets.                                                                                                                                                                                |
| `INTEREST_BACKUPS`     | Selected event's recovery bucket. `interests/`, `poster-proposals/`, `speaker-content/`, `attendees/`, `publications/`, event-photo review and receipt snapshot prefixes keep their existing meanings.                                                                                                                   |
| Daily event backups    | Iterate configured events separately: encrypted interests, poster proposals, canonical speaker content, attendee roster/arrival history, publication queue, photo reviews, receipt metadata and receipt recovery objects. Access credentials remain omitted where previously omitted.                                    |
| Event mail backups     | `event-mailing/latest.json` and `event-mailing/snapshots/` contain event-message preferences, draft, campaigns and deliveries only. Snapshots expire after 30 days.                                                                                                                                                      |
| Shared news backups    | Once per daily run, `shared/newsletter/latest.json` and `shared/newsletter/snapshots/` in the original backup bucket contain shared subscriber/consent/provider state only. Snapshots expire after 30 days. Historical combined `mailing/snapshots/` objects expire under the same policy; they are no longer generated. |
| Hourly digest schedule | Shared Mailrelay sync runs once. Poster, organizer data-change and speaker-review jobs run separately per event and read only that database. New editions default these digest switches off.                                                                                                                             |
| Daily cleanup          | Newsletter cleanup runs once against shared state. Dinner retention, speaker workspace/contact/media cleanup, feedback expiry and review-token cleanup run separately for each event. New events do not inherit 2026 deadlines; configure edition-specific settings before enabling the corresponding workflows.         |

Existing retention periods are preserved. Manual exports and downloaded backups
still require deletion under the retention policy of the event that produced
them. Purging event records must not purge shared subscription history.

## Provision a future event

Provisioning is an explicit operator action. No 2027 event or dataset is created
by this change.

1. Create a new D1 database and three R2 buckets. Add their bindings to
   `wrangler.jsonc`, using names distinct from existing editions. Configure the
   D1 binding with `migrations_dir: "migrations"`.
2. Generate a schema from repository migrations, with no private rows or edition
   content copied:

   ```bash
   npm run --silent db:event-schema -- EVENT_ID > /tmp/empty-event.sql
   npx wrangler d1 execute NEW_EVENT_DATABASE --remote --file /tmp/empty-event.sql
   ```

   Run this only against a new empty database. The generator refuses `2026`,
   excludes shared newsletter tables and all source data, and initializes only
   empty workspace settings and the migration ledger.

3. Add an entry to the JSON `EVENT_WORKSPACES` variable:

   ```json
   {
     "id": "EVENT_ID",
     "label": "Event display label",
     "database": "NEW_EVENT_DATABASE",
     "uploads": "NEW_EVENT_UPLOADS",
     "exports": "NEW_EVENT_EXPORTS",
     "backups": "NEW_EVENT_BACKUPS"
   }
   ```

   Use a lowercase slug for the actual ID. Optional `settings` may override only
   the event deadline, retention and digest variables listed in
   `worker/event-workspaces.ts`; shared account/provider settings are excluded.

4. Regenerate types, run the checks and deploy. The migration scripts iterate all
   configured event databases and verify new-event ownership before applying
   migrations. Future migrations that seed edition content must explicitly
   check `event_dataset.event_id`; schema changes can apply to every edition.

Attendees/catering, badges, organizers, volunteers, registration staff, Q&A,
interest-list review, poster review, event messaging and activity use portable
templates and start empty. 2026's programme/speaker assignments, feedback consent
wording, photo catalog, production library, media render manifests, music, intro,
slides and venue materials remain edition content. Their routes return 404 for
other events and are absent from those menus until a deliberate content adapter
is added. Creating an admin workspace does not publish an event or generate a
public archive.

## Rollback and verification

Migration `0044` adds only the 2026 ownership marker. There is no destructive
record migration and no production D1/R2 data copy. Rolling back application code
leaves the additive table harmless and preserves earlier URLs and media access.
To remove a newly configured event from navigation, remove its catalog entry;
its separate database/buckets remain available for recovery. Keep any received
event links operational or explicitly revoke them before retiring its resources.

`test/event-workspaces*.test.mjs` verifies empty bootstrap, resource validation,
database isolation, legacy links, staff-link boundaries, shared consent and
scoped daily backups. `npm run events:browser-check` uses two event fixtures in
Chromium and WebKit to check selection, simultaneous-tab writes, the shared news
workspace, preserved 2026 shortlists and mobile/desktop navigation. No fixture
event is added to production configuration.
