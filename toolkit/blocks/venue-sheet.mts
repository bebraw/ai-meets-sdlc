export type VenuePrintEntry =
  | { label: string; topic: string; question?: string }
  | {
      title: string;
      detail?: string;
      direction?: "left" | "right" | "ahead";
      qr?: string;
    };

export const venueSheetCss = `
@page { size: A4 portrait; margin: 0; }
article { box-sizing: border-box; width: 210mm; height: 297mm; overflow: hidden; }
.sign { padding: 14mm; display: flex; flex-direction: column; gap: 8mm; }
.brand { font-size: 18pt; font-weight: 700; color: var(--accent); }
h1, p { margin: 0; }
h1 { font-size: 46pt; line-height: 1.07; overflow-wrap: anywhere; }
p { font-size: 20pt; line-height: 1.25; overflow-wrap: anywhere; }
.arrow { height: 45mm; width: 45mm; color: var(--accent); }
.qr { width: 48mm; height: 48mm; align-self: start; margin-top: auto; }
.face { box-sizing: border-box; height: 99mm; padding: 8mm 12mm; display: flex; flex-direction: column; justify-content: center; gap: 3mm; overflow: hidden; }
.face h1 { font-size: 27pt; }
.face p { font-size: 13pt; }
.face .brand { font-size: 11pt; }
.face:first-child { transform: rotate(180deg); }
.fold { height: 0; border-top: 0.3mm dashed #888; position: relative; margin-bottom: -0.3mm; }
`;

/** Standalone so the PDF renderer can evaluate the same layout in Chromium. */
export function renderVenueSheets({
  eventName,
  entries,
  accent = "#245c49",
  target = document.body,
}: {
  eventName: string;
  entries: VenuePrintEntry[];
  accent?: string;
  target?: HTMLElement;
}) {
  function element<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    value?: string | null,
    cls?: string,
  ): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (value) node.textContent = value;
    if (cls) node.className = cls;
    return node;
  }
  for (const [index, row] of entries.entries()) {
    const sheet = element("article");
    target.appendChild(sheet);
    sheet.style.setProperty("--accent", accent);
    if ("topic" in row) {
      const face = element("section", null, "face");
      face.appendChild(element("div", `${eventName} · ${row.label}`, "brand"));
      face.appendChild(element("h1", row.topic));
      if (row.question) face.appendChild(element("p", row.question));
      sheet.appendChild(face);
      sheet.appendChild(element("div", null, "fold"));
      sheet.appendChild(face.cloneNode(true));
      sheet.appendChild(element("div", null, "fold"));
    } else {
      sheet.className = "sign";
      sheet.appendChild(element("div", eventName, "brand"));
      if (row.direction) {
        const ns = "http://www.w3.org/2000/svg",
          arrow = document.createElementNS(ns, "svg"),
          path = document.createElementNS(ns, "path");
        arrow.setAttribute("viewBox", "0 0 100 100");
        arrow.setAttribute("class", "arrow");
        arrow.setAttribute("aria-label", row.direction);
        path.setAttribute("d", "M10 39 H57 V16 L92 50 L57 84 V61 H10 Z");
        path.setAttribute("fill", "currentColor");
        path.setAttribute(
          "transform",
          `rotate(${{ right: 0, left: 180, ahead: -90 }[row.direction]} 50 50)`,
        );
        arrow.appendChild(path);
        sheet.appendChild(arrow);
      }
      sheet.appendChild(element("h1", row.title));
      if (row.detail) sheet.appendChild(element("p", row.detail));
      if (row.qr) {
        const image = element("img", null, "qr");
        image.src = row.qr;
        image.alt = "QR code";
        sheet.appendChild(image);
      }
    }
    sheet.dataset.index = String(index + 1);
  }
}
