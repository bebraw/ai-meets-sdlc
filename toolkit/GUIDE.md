# Event organizer toolkit

Choose the pieces of SDLCAI you need for your own event. The 19 blocks below cover jobs from printing name badges to moderating questions. You can run one block on its own or enable several in the same workspace.

## Try a block

- **In a browser.** From the [version 0.1.0 source ZIP](https://github.com/bebraw/ai-meets-sdlc/archive/fdf247620ea2cd71713921cdbb3095625340e723.zip), open a terminal in the extracted repository. With Node.js 24 installed, run the commands below and open the private organizer link. Select **Print name badges**, the PDF export action and **Use example**. Edit a name, run the export and download the PDF.
- **With an AI assistant.** Connect the [stdio MCP server](README.md#connect-an-mcp-client). Ask the assistant to read `event-toolkit://catalog`, import a ticket CSV and check that every name fits on a badge. The catalog supplies the allowed operations, examples and input schemas.
- **In your application.** [Install the tarball](README.md#install-in-a-fresh-project) and call `createToolkit({ enabled: ["lanyards"] })`. Use `kit.run("lanyards_count", input)` to get an order by color. The [TypeScript example](README.md#embed-in-typescript-or-javascript) shows the input and result.

```sh
npm ci
npx playwright install chromium
export TOOLKIT_BLOCKS=badges
npm run dev -w @sdlcai/event-toolkit
```

Use a comma-separated list of block IDs in `TOOLKIT_BLOCKS`. For example, `registration-import,check-in` gives you the CSV importer and arrivals desk.

## Registration and the venue

| Block               | Block ID              | What you can do                                                                   |
| ------------------- | --------------------- | --------------------------------------------------------------------------------- |
| Registration import | `registration-import` | Turn a Tito, Webropol or custom CSV into a roster with stable ticket identifiers. |
| Check-in desk       | `check-in`            | Give desk staff access to look up a ticket, record an arrival or undo a check-in. |
| Name badges         | `badges`              | Preview each badge, check that every name fits and export the print PDF.          |
| Lanyard orders      | `lanyards`            | Count lanyards by role and color, including the spares you want to order.         |
| Venue signs         | `venue-signs`         | Print directions and signs that link guests to the programme.                     |
| Table tents         | `table-tents`         | Lay out folded table cards with a label visible from either side.                 |

## Speakers and programme

| Block             | Block ID            | What you can do                                                                  |
| ----------------- | ------------------- | -------------------------------------------------------------------------------- |
| Poster proposals  | `poster-proposals`  | Open a call, collect consent, review submissions and export accepted presenters. |
| Speaker workspace | `speaker-workspace` | Invite speakers to submit talk copy and approve which PDFs can be shared.        |
| Programme feed    | `programme-feed`    | Check that speakers and sessions match, then export a public feed.               |
| Event schedule    | `schedule`          | Turn programme data into an agenda or venue screen in the event’s time zone.     |
| Talk graphics     | `talk-graphics`     | Generate a branded PNG for a speaker or session.                                 |

## People and hospitality

| Block               | Block ID              | What you can do                                                           |
| ------------------- | --------------------- | ------------------------------------------------------------------------- |
| Organizer directory | `organizer-directory` | Arrange team profiles and choose which ones visitors can see.             |
| Dinner invitations  | `dinner-rsvps`        | Collect individual replies and hand over meal counts without guest names. |
| Catering brief      | `catering`            | Combine attendance and dietary requirements into a brief for the caterer. |

## Audience and communications

| Block             | Block ID            | What you can do                                                                        |
| ----------------- | ------------------- | -------------------------------------------------------------------------------------- |
| Audience Q&A      | `audience-qa`       | Take questions and votes, moderate submissions and put a question on the stage screen. |
| Event feedback    | `event-feedback`    | Publish a survey, collect responses and report the results.                            |
| Attendee messages | `attendee-messages` | Preview an email for eligible event contacts, send it and check delivery outcomes.     |
| Newsletter        | `newsletter`        | Confirm email subscriptions and track withdrawals across events.                       |
| Publication queue | `publication-queue` | Review channel copy and assets, schedule a post and record its published URL.          |

## Hosting

Run the reference host on Node.js with SQLite. The browser and MCP share records when they use the same event ID and persistent data directory. Storage, mail delivery and form verification have replaceable adapters. Cloudflare D1 is one option for the organizer directory. See the [hosting and storage guide](README.md) for configuration and backups.

Version 0.1.0 is available as a tarball. Its software license is marked `UNLICENSED`.
