const htmlEscapes: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escape = (s: string) =>
  String(s).replace(/[&<>"']/g, (c) => htmlEscapes[c]!);

export function renderSchedule({
  eventName,
  timeZone,
  mode = "agenda",
  sessions,
}: {
  eventName: string;
  timeZone: string;
  mode?: "agenda" | "screen" | undefined;
  sessions: {
    start: string;
    end?: string | undefined;
    title: string;
    speakers?: string[] | undefined;
    room?: string | undefined;
  }[];
}) {
  const format = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const entries = [...sessions]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .map((row) => {
      if (row.end && Date.parse(row.end) < Date.parse(row.start))
        throw new Error("A session ends before it starts: " + row.title);
      return {
        ...row,
        displayTime:
          format.format(new Date(row.start)) +
          (row.end ? " – " + format.format(new Date(row.end)) : ""),
      };
    });
  const body = entries
    .map(
      (row) =>
        "<li><time>" +
        escape(row.displayTime) +
        "</time><div><strong>" +
        escape(row.title) +
        "</strong><p>" +
        [...(row.speakers ?? []), row.room]
          .filter((value): value is string => Boolean(value))
          .map(escape)
          .join(" · ") +
        "</p></div></li>",
    )
    .join("");
  const html =
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' +
    escape(eventName) +
    '</title><style>*{box-sizing:border-box}body{max-width:72rem;margin:auto;padding:4vw;color:#172d27;background:#f8f5eb;font:18px/1.45 sans-serif}h1{font:clamp(2.6rem,6vw,6rem)/1 Georgia,serif;margin:.5em 0}ol{padding:0;list-style:none}li{padding:1em 0;border-top:1px solid;display:grid;grid-template-columns:minmax(9em,28%) 1fr;gap:1em}p{margin:.25em 0}body.screen{color:white;background:#152e27;font-size:clamp(1.2rem,2.7vw,3rem)}@media(max-width:550px){li{display:block}}@media print{body{color:black!important;background:white!important}li{break-inside:avoid}}</style><body class="' +
    mode +
    '"><main><h1>' +
    escape(eventName) +
    "</h1><p>" +
    escape(timeZone) +
    "</p><ol>" +
    body +
    "</ol></main></body></html>";
  return { entries, html };
}

interface TalkArtwork {
  eventName: string;
  title: string;
  speaker: string;
  caption?: string | undefined;
  portrait?: string | undefined;
  accent?: string | undefined;
}

/** Incoming accent colors and embedded portrait URLs are validated by the caller. */
export function renderTalkArtwork({
  eventName,
  title,
  speaker,
  caption = "",
  portrait,
  accent = "#b5e9b0",
}: TalkArtwork) {
  const css =
    "body{background:#152b24;color:#fffbef;font-family:Print,sans-serif}main{padding:6vmin;display:grid;height:100vh;grid-template-rows:auto 1fr auto;gap:3vmin;border-top:2vmin solid " +
    accent +
    "}header,footer{font-size:4vmin}header{color:" +
    accent +
    "}section{display:flex;gap:5vmin;min-height:0;align-items:center}h1{font-size:9vmin;line-height:1.04;overflow-wrap:anywhere;margin:0 0 2vmin}p{font-size:4.3vmin;line-height:1.18;margin:0}img{width:28%;max-height:100%;object-fit:cover;border-radius:2px}";
  const html =
    "<main><header>" +
    escape(eventName) +
    "</header><section><div><h1>" +
    escape(title) +
    "</h1><p>" +
    escape(caption) +
    "</p></div>" +
    (portrait ? '<img alt="" src="' + escape(portrait) + '">' : "") +
    "</section><footer>" +
    escape(speaker) +
    "</footer></main>";
  return { css, html };
}

/** Runs in the artwork document. Playwright serializes this function into its print page. */
export async function fitTalkArtwork(doc: Document = document) {
  await doc.fonts.ready;
  await Promise.all(Array.from(doc.images).map((image) => image.decode()));
  const viewport = doc.defaultView;
  const section = doc.querySelector("section")?.getBoundingClientRect();
  const title = doc.querySelector("h1");
  if (!viewport || !section || !title?.parentElement) return false;
  for (let size = 9; size >= 4; size -= 0.25) {
    title.style.fontSize = size + "vmin";
    const text = title.parentElement.getBoundingClientRect();
    if (
      text.top >= section.top - 1 &&
      text.bottom <= section.bottom + 1 &&
      doc.documentElement.scrollWidth <= viewport.innerWidth &&
      doc.documentElement.scrollHeight <= viewport.innerHeight
    )
      return true;
  }
  return false;
}
