# Event organizer toolkit

An organizer can import a ticket export, print badges, run a registration desk or collect speaker materials from one workspace. Each of the 19 blocks also exposes the same operations to a TypeScript or JavaScript application and a Model Context Protocol (MCP) client. Choose the blocks your event needs. The reference host runs on Node.js 24 or later with SQLite.

Start with the [organizer guide](GUIDE.md) for a badge walkthrough and a catalog grouped by task.

## Install in a fresh project

The **Portable toolkit** job on a successful pull-request quality run attaches the tested tarball as the `event-toolkit` artifact. Download and unzip it, or create the package from this repository.

```sh
npm pack ./toolkit --pack-destination /tmp
```

Give the resulting tarball to another organizer. On their machine, with the tarball in `/tmp`, the following creates a new project and starts the workspace.

```sh
mkdir autumn-gathering
cd autumn-gathering
npm init -y
npm install /tmp/sdlcai-event-toolkit-0.1.0.tgz
npx playwright install chromium
export TOOLKIT_EVENT=autumn-gathering
export TOOLKIT_DATA_DIR="$PWD/event-data"
npx event-toolkit ui
```

Use the private organizer link printed in the terminal. The default host is `127.0.0.1:3000`. Opening the plain URL gives a visitor the public workspace. Chromium renders print files and talk artwork. For an existing Chromium installation, set `TOOLKIT_CHROMIUM_PATH` to its executable. The roster, proposal and other data workflows can run without a browser installation on the server.

From a checkout with dependencies installed, `npm run dev -w @sdlcai/event-toolkit` compiles the TypeScript and starts the same workspace. Run `npm run toolkit:check` from the repository root to run the block tests and repeat the separate-project installation check.

Version 0.1.0 is distributed here as a tarball. Its software license is marked `UNLICENSED`. The bundled Noto Sans font carries its own [SIL Open Font License](assets/print/OFL.txt).

In **Print name badges**, choose a person or spare under **Badge to preview**. Your browser redraws its SVG as you edit the text, role colors, logo or paper settings. Preflight checks every row and marks entries that need attention. The PDF export repeats those checks before producing the print file.

## Choose blocks

By default the workspace enables all 19. To run a registration desk, for example, set `TOOLKIT_BLOCKS=registration-import,check-in` before starting the UI or MCP server. The catalog lists only enabled operations available to the caller and gives their schemas, descriptions and sample inputs.

| Block ID              | What an organizer can make or do                                                                         | Operations to start with                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `badges`              | Check names and artwork against trim and bleed, then export a print PDF.                                 | `badges_preflight`, `badges_export_pdf`                                                    |
| `lanyards`            | Turn named participants and spare badges into an order by role and color.                                | `lanyards_count`                                                                           |
| `registration-import` | Map a Tito, Webropol or generic CSV to registration records with stable source keys.                     | `registration_import_csv`                                                                  |
| `venue-signs`         | Print venue signage, including directions and programme links.                                           | `venue_signs_export_pdf`                                                                   |
| `table-tents`         | Build printable folded table cards.                                                                      | `table_tents_export_pdf`                                                                   |
| `catering`            | Count meals, combine dietary requirements and export a caterer brief.                                    | `catering_prepare_brief`                                                                   |
| `programme-feed`      | Validate event, session and speaker references and export a versioned public feed.                       | `programme_build_feed`                                                                     |
| `schedule`            | Make a standalone agenda or venue screen in the event time zone.                                         | `schedule_render`                                                                          |
| `talk-graphics`       | Render branded speaker and session artwork as a PNG.                                                     | `talk_graphics_export`                                                                     |
| `organizer-directory` | Maintain ordered organizer profiles and expose the visible profiles publicly.                            | `organizers_create`, `organizers_list`, `organizers_public`                                |
| `check-in`            | Register or link roster sources, issue desk grants, look up tickets, record and undo arrivals.           | `checkin_register`, `checkin_issue_grant`, `checkin_lookup`, `checkin_arrive`              |
| `poster-proposals`    | Open a call with consent wording and a deadline, review proposals and export accepted presenters.        | `posters_configure_call`, `posters_submit`, `posters_decide`, `posters_presenters`         |
| `dinner-rsvps`        | Invite individual guests, collect replies, and hand over unnamed meal and dietary counts.                | `dinner_invite`, `dinner_respond`, `dinner_catering`                                       |
| `speaker-workspace`   | Invite a speaker, review talk copy and manage consent and publication of PDF materials.                  | `speaker_assign`, `speaker_submit`, `speaker_review`, `speaker_programme`                  |
| `audience-qa`         | Take questions and votes, moderate them and select a question for the stage screen.                      | `qa_configure_room`, `qa_ask`, `qa_moderate`, `qa_screen`                                  |
| `event-feedback`      | Publish a versioned feedback form, accept and withdraw responses, and report results.                    | `feedback_publish_form`, `feedback_respond`, `feedback_report`                             |
| `attendee-messages`   | Select eligible event contacts, preview a message, send individual emails and inspect delivery outcomes. | `messages_set_audience`, `messages_preview`, `messages_send`, `messages_history`           |
| `newsletter`          | Collect consent, confirm email ownership, and track withdrawals across events in one installation.       | `newsletter_configure`, `newsletter_subscribe`, `newsletter_confirm`, `newsletter_changes` |
| `publication-queue`   | Track channel copy, assets, sources, dates and publication URLs through editorial review.                | `publication_save`, `publication_list`                                                     |

### Use the workspace

Select a block and an operation. For example, create a check-in roster, issue a desk grant, then open the grant link at the registration desk. The desk operator can look up a ticket and record its arrival. Organizers can review history and undo mistakes. Dinner and speaker invitations similarly open the recipient's record. Share each private link only with its intended recipient.

In a speaker workspace, organizers can prepare a draft for the assigned speaker. The speaker submits their publication choice, then an organizer can approve the revision. Each PDF has its own sharing permission. Withdrawing permission removes public access to that material.

Print operations show preflight issues or return an artifact to download. The server keeps generated downloads for up to 15 minutes in a 64 MiB in-memory cache. Save a copy for printing or distribution.

### Connect an MCP client

Point a stdio-capable MCP client to the installed CLI. Replace the absolute paths in this example and use the same `TOOLKIT_EVENT` and `TOOLKIT_DATA_DIR` as the UI to share an event. Choose a role for this client and a stable actor ID. Only its allowed tools are advertised.

```json
{
  "mcpServers": {
    "autumn-production": {
      "command": "/absolute/path/to/node",
      "args": [
        "/absolute/path/to/autumn-gathering/node_modules/@sdlcai/event-toolkit/cli.mjs",
        "mcp"
      ],
      "env": {
        "TOOLKIT_BLOCKS": "registration-import,badges,lanyards",
        "TOOLKIT_EVENT": "autumn-gathering",
        "TOOLKIT_DATA_DIR": "/absolute/path/to/autumn-gathering/event-data",
        "TOOLKIT_ROLE": "organizer",
        "TOOLKIT_ACTOR": "print-assistant"
      }
    }
  }
}
```

An assistant can read the `event-toolkit://catalog` resource to inspect operation examples and schemas, then call the operations by name. For example, ask it to import a Tito CSV, use the imported names in a badge preflight, and count lanyards by role including ten attendee spares. A tool response includes structured data. When it produces a file, read the returned artifact URI using MCP `resources/read` on the same connection. For stateful edits, use IDs, revisions and capabilities from earlier results. On a revision conflict, fetch the current record before applying the intended edit.

`npx event-toolkit catalog` prints the role-filtered catalog as JSON, which also works with coding assistants that read local files.

### Embed in TypeScript or JavaScript

```js
import { createToolkit } from "@sdlcai/event-toolkit";

const app = createToolkit({ enabled: ["lanyards"] });
try {
  const order = await app.run("lanyards_count", {
    people: [{ role: "speaker" }, { role: "attendee" }],
    spares: [{ role: "attendee", count: 10 }],
  });
  console.log(order.total, order.byColor);
} finally {
  await app.close();
}
```

TypeScript infers the input and result from the operation name. For example, `order.total` is a number. Import `OperationInput<"lanyards_count">` or `OperationResult<"lanyards_count">` as types when declaring your own functions.

The package ships compiled ES modules, generated TypeScript declarations and the TypeScript source. Each operation declares its input once in Valibot. The toolkit validates input before opening the operation’s storage or calling a provider, and converts the schema to JSON Schema for browser forms and MCP discovery.

Try any block from the catalog by passing its ID to the example below. It uses fictional data and an in-memory database. For file-producing operations, an optional second argument saves the artifact to a new file.

```sh
node node_modules/@sdlcai/event-toolkit/examples/try-block.mjs lanyards
node node_modules/@sdlcai/event-toolkit/examples/try-block.mjs venue-signs signs.pdf
```

Run `node node_modules/@sdlcai/event-toolkit/examples/badges.mjs` to write a badge PDF using a sample registration export. Run `node node_modules/@sdlcai/event-toolkit/examples/engagement.mjs newsletter` to exercise a confirmation and withdrawal using an in-memory mail adapter.

The library accepts `{ enabled, eventId, directory, services }`. Omitting `directory` gives this instance ephemeral storage. `app.catalog(principal)` discovers operations, and `app.run(name, input, principal)` executes one. File-producing operations place the bytes in `result.artifact.bytes`. A trusted local invocation defaults to an organizer. In an application serving other people, supply `{ role, actor }` from the authenticated session on each call.

## Hosting and adapters

The package runs independently of the event website. Use a persistent volume for SQLite on a Node host. Run one UI process per event. The UI and local MCP processes can share the same event directory on that host. The first nine catalog entries use supplied input and require no database. Most other blocks create tables in `event-<event-id>.sqlite`. Newsletter uses `installation.sqlite` so an organizer can run multiple events against one subscriber list. Give independent organizers separate directories.

| Setting                                                  | Purpose                                                                                                                                                                    |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `TOOLKIT_EVENT`, `TOOLKIT_EVENT_LABEL`                   | Event ID and optional human-readable name. The CLI defaults to `local-event`. Use lowercase letters, digits and single hyphens for IDs.                                    |
| `TOOLKIT_DATA_DIR`, `TOOLKIT_BLOCKS`                     | Persistent directory (CLI default `~/.event-toolkit`) and comma-separated enabled block IDs.                                                                               |
| `TOOLKIT_HOST`, `TOOLKIT_PORT`, `TOOLKIT_PUBLIC_ORIGIN`  | Listen address, port and externally reachable origin for browser actions and invitation links. Set the public origin for a link-generating MCP client too.                 |
| `TOOLKIT_PRINCIPALS`                                     | JSON array of trusted UI credentials, each with `token`, `role` and stable `actor`. Roles are `organizer`, `staff`, `public`, `speaker`, `moderator`, `mc` and `attendee`. |
| `TOOLKIT_ACCESS_TOKEN`                                   | Single organizer credential for the UI. Generate a long, random value and keep it private.                                                                                 |
| `TOOLKIT_ROLE`, `TOOLKIT_ACTOR`                          | Principal for the stdio MCP process or catalog command. Both default to a local organizer.                                                                                 |
| `TOOLKIT_SMTP_URL`, `TOOLKIT_MAIL_FROM`                  | SMTP connection and sender for attendee messages, newsletter confirmations and optional speaker invitation mail.                                                           |
| `TOOLKIT_TURNSTILE_SITE_KEY`, `TOOLKIT_TURNSTILE_SECRET` | Optional Cloudflare Turnstile adapter for supported public submissions. Configure both keys for the public origin.                                                         |

When binding beyond loopback, configure a public origin and explicit credentials. Terminate HTTPS at the reverse proxy, preserve the public `Host` header and restrict direct access to the Node listener. Keep credentials in the host's secret configuration. A browser user can enter the token via the workspace. An authenticated service can use `Authorization: Bearer <token>` on `GET /api/catalog` and `POST /api/run/<operation>`. A write returns JSON with `data` and optional `artifact`. Public visitors receive a session-scoped actor ID. Resource-specific permissions still apply, including desk grants, speaker assignments and guest invitation tokens.

For another provider, inject `services.sendMail({to, subject, text})`, `services.verifyChallenge({action, token, actor, eventId})` and `services.actionUrl(operation, input, eventId)` as needed. The live event Worker's organizer directory and the toolkit use the same revision-checked SQL store. The `@sdlcai/event-toolkit/organizer-store` entry exports `organizerStore` for a host that supplies SQL reads and writes, and `d1OrganizerStore` for an existing Cloudflare D1 binding. Other stateful blocks in the reference host use Node SQLite. Rendering uses local Chromium.

The reference mail and challenge adapters are available independently from `@sdlcai/event-toolkit/providers`. Assign `await createSmtpSender({ url, from })` to `services.sendMail` and `createTurnstileVerifier({ secret, publicOrigin })` to `services.verifyChallenge` to use them in another host. The Turnstile verifier checks the submitted action and the public origin's hostname. Provide the matching site key to the browser.

To run the organizer directory on D1, provision one database per event. Prepare the schema once in the event database and give the toolkit its store. UI, MCP and embedded calls then share D1 revisions and visibility rules.

```js
import { createToolkit } from "@sdlcai/event-toolkit";
import {
  d1OrganizerStore,
  organizerSchema,
} from "@sdlcai/event-toolkit/organizer-store";

export async function openEventDirectory(eventId, eventDatabase) {
  await eventDatabase.prepare(organizerSchema).run();
  return createToolkit({
    enabled: ["organizer-directory"],
    eventId,
    services: { organizerStore: d1OrganizerStore(eventDatabase) },
  });
}
```

For the other stateful workflows, an embedded host can pass a `storage` factory. The toolkit calls it once when a block first needs SQLite, with the event ID and optional data directory. For example, a host can select its installation volume while using the packaged reference adapter.

```js
import { createToolkit } from "@sdlcai/event-toolkit";
import { openStorage } from "@sdlcai/event-toolkit/storage";

const app = createToolkit({
  enabled: ["audience-qa", "newsletter"],
  eventId: "autumn-gathering",
  storage: ({ eventId }) =>
    openStorage({ eventId, directory: "/var/lib/field-notes" }),
});
```

A custom `StorageFactory` may open asynchronously. Its handle supplies `event()`, `shared()` and `close()`. Each scope provides a synchronous SQLite-compatible connection with `exec` and prepared `get`, `all`, `iterate` and `run` statements. Stateful blocks use SQLite transactions and `RETURNING`. Supply `seal`, `open` and `fingerprint` on each scope with authenticated encryption and stable scope-specific keys. Use event isolation for `event()` and organizer-wide isolation for `shared()`. The package exports the TypeScript interfaces for implementing this contract.

## Retention and backup

Dinner invitations carry a response deadline and a separate deletion date. Feedback forms record the retention period with the form version. Pending newsletter signups expire after 24 hours. Unsent campaign previews are discarded after seven days. The UI runs cleanup on startup and hourly. For MCP-only or occasional hosts, schedule `npx event-toolkit maintain` with the event's normal block and directory settings. Run it for each event that needs cleanup. Other event records, including rosters, speaker materials and editorial history, persist until the operator retires their storage.

For a consistent backup, stop the UI and MCP processes and other writers that use the directory. Copy the entire data directory, including `encryption.key`, event and installation databases and any SQLite journal files. Selected private fields and stored speaker materials are encrypted using scope-specific keys derived from that file. Restore the directory and matching key together before restarting with the original event ID. Protect backup access and expire old copies according to the event's retention policy. Restore host credentials and provider settings from the host's secret configuration separately.
