const NS = "http://www.w3.org/2000/svg";
const pt = 25.4 / 72;

export async function verifyBadgeLogo(logo) {
  if (!logo) return;
  const image = new Image();
  image.src = logo;
  try {
    await image.decode();
  } catch {
    throw new Error("The supplied badge logo could not be decoded.");
  }
}
export async function loadBadgeFont(bytes) {
  const has = fontCoverage(bytes);
  const family = `BadgeFont${crypto.randomUUID().replaceAll("-", "")}`;
  const face = new FontFace(family, bytes, { weight: "100 900" });
  await face.load();
  document.fonts.add(face);
  return { family, has };
}
// Read the font's Unicode cmap, rather than guessing coverage from text width.
export function fontCoverage(bytes) {
  const data = new DataView(bytes);
  let cmap = 0;
  for (let i = 0; i < data.getUint16(4); i++) {
    const offset = 12 + i * 16;
    if (data.getUint32(offset) === 0x636d6170)
      cmap = data.getUint32(offset + 8);
  }
  if (!cmap)
    throw new Error(
      "Choose a TrueType/OpenType font with a Unicode character map.",
    );
  const tables = [];
  for (let i = 0; i < data.getUint16(cmap + 2); i++) {
    const offset = cmap + 4 + i * 8;
    const platform = data.getUint16(offset);
    const encoding = data.getUint16(offset + 2);
    if (platform === 0 || (platform === 3 && [1, 10].includes(encoding)))
      tables.push(cmap + data.getUint32(offset + 4));
  }
  if (!tables.some((t) => [4, 12].includes(data.getUint16(t))))
    throw new Error("Unsupported font character map.");
  return (code) =>
    tables.some((t) => {
      const format = data.getUint16(t);
      if (format === 12) {
        const count = data.getUint32(t + 12);
        for (let i = 0; i < count; i++) {
          const p = t + 16 + i * 12;
          const start = data.getUint32(p),
            end = data.getUint32(p + 4);
          if (code >= start && code <= end)
            return data.getUint32(p + 8) + code - start !== 0;
        }
      }
      if (format === 4 && code <= 0xffff) {
        const count = data.getUint16(t + 6) / 2;
        const ends = t + 14,
          starts = ends + count * 2 + 2,
          deltas = starts + count * 2,
          offsets = deltas + count * 2;
        for (let i = 0; i < count; i++) {
          if (
            code < data.getUint16(starts + i * 2) ||
            code > data.getUint16(ends + i * 2)
          )
            continue;
          const delta = data.getInt16(deltas + i * 2),
            range = data.getUint16(offsets + i * 2);
          if (!range) return ((code + delta) & 0xffff) !== 0;
          const glyph = data.getUint16(
            offsets +
              i * 2 +
              range +
              2 * (code - data.getUint16(starts + i * 2)),
          );
          return glyph !== 0 && ((glyph + delta) & 0xffff) !== 0;
        }
      }
      return false;
    });
}
function svg(tag, attrs) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs))
    node.setAttribute(key, String(value));
  return node;
}
export function renderBadgeArtwork(
  person,
  settings,
  font,
  preview,
  spare,
  appearance,
  logo,
) {
  const d = settings.diameter,
    b = settings.bleed,
    r = d / 2 - settings.safe;
  const page = d + b * 2;
  const issues = [];
  const { foreground: color, background } = appearance;
  const root = svg("svg", {
    viewBox: `0 0 ${page} ${page}`,
    width: `${page}mm`,
    height: `${page}mm`,
    role: "img",
    "aria-label": spare
      ? `Spare ${person.role} badge`
      : `${person.role} badge for ${person.name}`,
  });
  root.append(svg("rect", { width: page, height: page, fill: background }));
  const content = svg("g", { transform: `translate(${b} ${b})`, fill: color });
  root.append(content);
  const text =
    `${person.name} ${person.company} ${person.role.toUpperCase()}`.normalize(
      "NFC",
    );
  if (!spare && !person.name.trim()) issues.push("Name is required.");
  if (
    /[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(text)
  )
    issues.push("Remove control or explicit text-direction characters.");
  const missing = [
    ...new Set(
      [...text].filter((c) => !/\s/u.test(c) && !font.has(c.codePointAt(0))),
    ),
  ];
  if (missing.length)
    issues.push(
      `Font lacks: ${missing.join(" ")}. Load a font that covers these characters.`,
    );
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  function block(value, top, bottom, maxPt, minPt, maxLines, weight, label) {
    if (!value.trim()) return;
    const halfHeight = Math.max(
      Math.abs(top - d / 2),
      Math.abs(bottom - d / 2),
    );
    const width =
      2 * Math.sqrt(Math.max(0, r * r - halfHeight * halfHeight)) - 2;
    if (width <= 0 || bottom <= top) {
      issues.push(`${label}: print settings leave no safe space.`);
      return;
    }
    const graphemes = new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    });
    let selected = null;
    for (let sizePt = maxPt; sizePt >= minPt; sizePt -= 0.5) {
      const size = sizePt * pt;
      ctx.font = `${weight} ${size}px "${font.family}"`;
      const widthOf = (s) => {
        const m = ctx.measureText(s);
        return Math.max(
          m.width,
          m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
        );
      };
      const lines = [];
      for (const paragraph of value.normalize("NFC").split("\n")) {
        let line = "";
        for (const word of paragraph.trim().split(/\s+/u)) {
          const candidate = line ? `${line} ${word}` : word;
          if (widthOf(candidate) <= width) {
            line = candidate;
            continue;
          }
          if (line) {
            lines.push(line);
            line = "";
          }
          for (const { segment } of graphemes.segment(word)) {
            if (line && widthOf(line + segment) > width) {
              lines.push(line);
              line = "";
            }
            line += segment;
          }
        }
        if (line) lines.push(line);
      }
      const step = size * 1.5;
      if (
        lines.length <= maxLines &&
        lines.length * step <= bottom - top &&
        lines.every((line) => widthOf(line) <= width)
      ) {
        selected = { lines, size, step };
        break;
      }
    }
    if (!selected) {
      issues.push(
        `${label} does not fit at the minimum size. Add line breaks, edit the badge text, or adjust print settings.`,
      );
      return;
    }
    const { lines, size, step } = selected;
    ctx.font = `${weight} ${size}px "${font.family}"`;
    const start = top + (bottom - top - step * lines.length) / 2;
    lines.forEach((line, i) => {
      const m = ctx.measureText(line);
      const baseline =
        start +
        step * i +
        (step - m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2 +
        m.actualBoundingBoxAscent;
      const half = Math.max(
        m.width / 2,
        m.actualBoundingBoxLeft - m.width / 2,
        m.actualBoundingBoxRight - m.width / 2,
      );
      const bounds = [
        baseline - m.actualBoundingBoxAscent,
        baseline + m.actualBoundingBoxDescent,
      ];
      if (
        bounds.some((y) => half * half + (y - d / 2) ** 2 > r * r) ||
        bounds[0] < top ||
        bounds[1] > bottom
      )
        issues.push(`${label} exceeds the safe area.`);
      const node = svg("text", {
        x: d / 2,
        y: baseline,
        "font-size": size,
        "font-weight": weight,
        "font-family": font.family,
        "text-anchor": "middle",
        direction: /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(line)
          ? "rtl"
          : "ltr",
      });
      node.textContent = line;
      content.append(node);
    });
  }
  // Separate vertical bands prevent name/company/logo/role collisions.
  const logoTop = settings.top + 2,
    logoSize = 16;
  if (logo && (logoSize / 2) ** 2 + (logoTop - d / 2) ** 2 > r * r)
    issues.push(
      "Logo is outside the safe circle. Adjust the top exclusion or diameter.",
    );
  if (logo)
    content.append(
      svg("image", {
        href: logo,
        x: d / 2 - logoSize / 2,
        y: logoTop,
        width: logoSize,
        height: logoSize,
      }),
    );
  block(
    person.name,
    logoTop + logoSize + 3,
    d * 0.69,
    settings.maxName,
    settings.minName,
    3,
    700,
    "Name",
  );
  block(
    person.company,
    d * 0.7,
    d * 0.81,
    settings.companySize,
    9,
    2,
    400,
    "Company",
  );
  block(person.role.toUpperCase(), d * 0.83, d * 0.9, 10, 9, 1, 700, "Role");
  if (preview || settings.guides) {
    content.append(
      svg("circle", {
        cx: d / 2,
        cy: d / 2,
        r: d / 2,
        fill: "none",
        stroke: "#888",
        "stroke-width": 0.2,
      }),
    );
    if (preview) {
      content.append(
        svg("circle", {
          cx: d / 2,
          cy: d / 2,
          r,
          fill: "none",
          stroke: "#888",
          "stroke-width": 0.2,
          "stroke-dasharray": "1 1",
        }),
      );
      content.append(
        svg("rect", {
          x: d / 2 - 16,
          y: 0,
          width: 32,
          height: settings.top,
          fill: "#888",
          opacity: 0.18,
        }),
      );
    }
  }
  return { svg: root, issues: [...new Set(issues)] };
}

const defaultGeometry = {
  diameter: 100,
  bleed: 0,
  safe: 5,
  top: 14,
  minName: 18,
  maxName: 30,
  companySize: 12,
  guides: false,
  doubleSided: false,
};
const defaultColors = {
  attendee: { background: "#ffffff", foreground: "#111111" },
  speaker: { background: "#171b24", foreground: "#ffffff" },
  organizer: { background: "#ffb780", foreground: "#141414" },
  sponsor: { background: "#92cabb", foreground: "#141414" },
};

/** Assemble distinct printable rows. Repeated spare copies and backs share one proof. */
export function prepareBadgeRun(input) {
  const settings = { ...defaultGeometry, ...input.settings };
  const palette = new Map(Object.entries(defaultColors));
  for (const entry of input.colors ?? []) palette.set(entry.role, entry);
  const rows = [];
  function add(person, quantity, source, row) {
    if (!quantity) return;
    rows.push({
      person,
      quantity,
      source,
      row,
      appearance: palette.get(person.role) ?? defaultColors.attendee,
    });
  }
  input.people.forEach((person, index) =>
    add(
      { name: person.name, company: person.company ?? "", role: person.role },
      1,
      "people",
      index + 1,
    ),
  );
  (input.spares ?? []).forEach((spare, index) =>
    add(
      { name: "", company: "", role: spare.role },
      spare.count,
      "spares",
      index + 1,
    ),
  );
  const badges = rows.reduce((count, entry) => count + entry.quantity, 0);
  if (!badges || badges > 4000)
    throw new Error("Select between one and 4,000 named and spare badges.");
  return {
    rows,
    settings,
    badges,
    widthMm: settings.diameter + 2 * settings.bleed,
    pageCount: badges * (settings.doubleSided ? 2 : 1),
  };
}
