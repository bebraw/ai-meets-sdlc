import { escapeHtml } from "./speaker-workspace-utils.ts";

export interface ReviewChange {
  before: string;
  field: string;
  value: string;
}

export interface ReviewDigestItem {
  name: string;
  changes: ReviewChange[];
  reviewUrl: string;
  conflict: boolean;
}

export function reviewFieldLabel(field: string): string {
  if (field.startsWith("talks.")) {
    return field.endsWith(".title") ? "Talk title" : "Talk description";
  }
  const name = field.replace(/^profile\./u, "");
  return (
    (
      { bio: "Biography", name: "Speaker name", role: "Role" } as Record<
        string,
        string
      >
    )[name] ?? `${name.charAt(0).toUpperCase()}${name.slice(1)} link`
  );
}

function emailExcerpt(value: string): string {
  return value.length > 700
    ? `${value.slice(0, 700)}… [Full text in review]`
    : value || "(empty)";
}

export function speakerReviewDigestEmail(
  items: ReviewDigestItem[],
  date: string,
  adminUrl: string,
) {
  const subject = `SDLCAI: ${items.length} speaker update${items.length === 1 ? "" : "s"} awaiting approval — ${date}`;
  const text = [
    "SDLCAI / Daily speaker review",
    "",
    `${items.length} submitted update${items.length === 1 ? " is" : "s are"} awaiting review.`,
    "Changes remain unpublished until you approve them. The review page shows every changed field before you confirm.",
    ...items.flatMap((item) => [
      "",
      item.name,
      ...(item.conflict
        ? [
            "The published content has changed or this revision needs attention. Review it in the admin area.",
          ]
        : []),
      ...item.changes.flatMap((change) => [
        "",
        reviewFieldLabel(change.field),
        `Current: ${emailExcerpt(change.before)}`,
        `Proposed: ${emailExcerpt(change.value)}`,
      ]),
      "",
      `Review${item.conflict ? " in admin" : " and approve"}: ${item.reviewUrl}`,
    ]),
    "",
    "Private approval links expire after seven days and only approve the revision shown. Keep this email private.",
    "Opening a link does not approve anything; confirm on the review page.",
    "Pending updates will appear in the daily digest until reviewed. No pending updates means no email.",
    "",
    `All speaker reviews: ${adminUrl}`,
  ].join("\n");
  const html = `<!doctype html><html lang="en"><body style="margin:0;background:#f6f4ef;color:#0b0b0b;font-family:Arial,sans-serif">
  <div style="max-width:680px;margin:auto;padding:32px 20px">
    <p style="font-size:13px;font-weight:bold;letter-spacing:2px">SDLCAI / DAILY SPEAKER REVIEW</p>
    <h1 style="font-size:32px;line-height:1.1">${items.length} update${items.length === 1 ? "" : "s"} awaiting approval</h1>
    <p style="line-height:1.6">Changes remain unpublished until you approve them. Open a review to see every changed field and confirm.</p>
    ${items
      .map(
        (
          item,
        ) => `<section style="border-top:3px solid #0b0b0b;margin-top:32px;padding-top:12px">
      <h2 style="font-size:24px">${escapeHtml(item.name)}</h2>
      ${item.conflict ? "<p>This revision needs attention in the admin area before it can be approved.</p>" : ""}
      <p><a href="${escapeHtml(item.reviewUrl)}" style="display:inline-block;background:#0b0b0b;color:#f6f4ef;padding:14px 20px;text-decoration:none;font-weight:bold">${item.conflict ? "Review in admin" : "Review and approve"}</a></p>
      ${item.changes
        .map(
          (
            change,
          ) => `<h3 style="font-size:16px;margin:24px 0 8px">${escapeHtml(reviewFieldLabel(change.field))}</h3>
        <p style="font-size:12px;font-weight:bold;margin-bottom:4px">CURRENT</p>
        <div style="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5;color:#57534e">${escapeHtml(emailExcerpt(change.before))}</div>
        <p style="font-size:12px;font-weight:bold;margin-bottom:4px">PROPOSED</p>
        <div style="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.5">${escapeHtml(emailExcerpt(change.value))}</div>`,
        )
        .join("")}
    </section>`,
      )
      .join("")}
    <p style="border-top:1px solid #0b0b0b;margin-top:32px;padding-top:20px;font-size:14px;line-height:1.6">Private approval links expire after seven days and only approve the revision shown. Keep this email private. Opening a link does not approve anything.</p>
    <p style="font-size:14px;line-height:1.6">Pending updates appear daily until reviewed. No pending updates means no email. <a href="${escapeHtml(adminUrl)}" style="color:#0b0b0b">All speaker reviews</a></p>
  </div></body></html>`;
  return { subject, text, html };
}

export function speakerReviewPage({
  title,
  intro,
  content = "",
  status = 200,
}: {
  title: string;
  intro: string;
  content?: string;
  status?: number;
}): Response {
  return new Response(
    `<!doctype html><html lang="en"><head>
    <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)} | SDLCAI</title>
    <style>
      @font-face{font-family:Finlandica;src:url('/assets/fonts/FinlandicaText-Regular.woff2') format('woff2');font-display:swap}
      @font-face{font-family:FinlandicaHeadline;src:url('/assets/fonts/FinlandicaHeadline-Black.woff2') format('woff2');font-display:swap}
      *{box-sizing:border-box}body{margin:0;background:#f6f4ef;color:#0b0b0b;font-family:Finlandica,Georgia,serif;font-size:18px;line-height:1.55}
      main{max-width:1056px;margin:auto;padding:48px 24px 72px}a{color:inherit;text-underline-offset:4px}a:focus-visible,button:focus-visible{outline:3px solid #985b00;outline-offset:5px}
      .eyebrow{font-size:13px;letter-spacing:2px;text-transform:uppercase;border-bottom:3px solid;padding-bottom:18px}
      h1,h2{font-family:FinlandicaHeadline,Georgia,serif;line-height:1.05}h1{font-size:clamp(36px,6vw,64px);max-width:900px;margin:32px 0 20px;overflow-wrap:anywhere}h2{font-size:26px;margin:32px 0 18px}
      .intro{max-width:760px;color:#514d47;margin-bottom:36px}.change{border-top:1px solid #aaa59c;padding:0 0 28px}.columns{display:grid;grid-template-columns:1fr 1fr;gap:28px}
      .label{font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase}.value{white-space:pre-wrap;overflow-wrap:anywhere;margin:10px 0}.current{color:#625d55}.proposed{background:#fff;padding:16px;border-left:3px solid #0b0b0b}
      form{border-top:3px solid;margin-top:24px;padding-top:24px}button{border:2px solid #0b0b0b;background:#0b0b0b;color:#f6f4ef;font:inherit;font-weight:bold;padding:16px 24px;cursor:pointer;min-height:48px}button:hover{background:#f6f4ef;color:#0b0b0b}
      .secondary{display:block;margin-top:24px}.note{font-size:15px;color:#514d47}@media(max-width:650px){main{padding:24px 18px 48px}.columns{grid-template-columns:1fr;gap:16px}button{width:100%}}
    </style></head><body><main>
    <p class="eyebrow">SDLCAI / Speaker review</p><h1>${escapeHtml(title)}</h1><p class="intro">${escapeHtml(intro)}</p>
    ${content}<a class="secondary" href="/admin/speakers/">Open speaker administration</a>
    </main></body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "referrer-policy": "no-referrer",
        "x-robots-tag": "noindex, nofollow, noarchive",
        "x-content-type-options": "nosniff",
        "x-frame-options": "DENY",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; font-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      },
    },
  );
}

export function reviewChangesHtml(changes: ReviewChange[]): string {
  return changes
    .map(
      (
        change,
      ) => `<section class="change"><h2>${escapeHtml(reviewFieldLabel(change.field))}</h2><div class="columns">
    <div class="current"><span class="label">Currently published</span><p class="value">${escapeHtml(change.before || "(empty)")}</p></div>
    <div class="proposed"><span class="label">Proposed change</span><p class="value">${escapeHtml(change.value || "(empty)")}</p></div>
    </div></section>`,
    )
    .join("");
}
