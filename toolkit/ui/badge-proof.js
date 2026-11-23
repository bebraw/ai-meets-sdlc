import {
  loadBadgeFont,
  prepareBadgeRun,
  renderBadgeArtwork,
  verifyBadgeLogo,
} from "./badge-artwork.mjs";

let fontPromise;
function bundledFont() {
  fontPromise ??= fetch("/badge-font.ttf")
    .then((response) => {
      if (!response.ok) throw Error("Could not load the bundled badge font.");
      return response.arrayBuffer();
    })
    .then(loadBadgeFont)
    .catch((error) => {
      fontPromise = undefined;
      throw error;
    });
  return fontPromise;
}
function element(tag, text) {
  const el = document.createElement(tag);
  if (text) el.textContent = text;
  return el;
}

/** Proof one distinct badge at a time, even when its sheet has hundreds of copies. */
export function attachBadgeProof(fields, read) {
  const panel = element("section"),
    select = element("select"),
    artwork = element("div"),
    findings = element("div"),
    summary = element("p");
  panel.className = "badge-review";
  panel.setAttribute("aria-label", "Badge proof");
  const label = element("label", "Badge to preview");
  label.htmlFor = select.id = "badge-proof-row";
  artwork.className = "badge-artwork";
  findings.id = "badge-findings";
  findings.setAttribute("role", "status");
  panel.append(
    element("h2", "Badge proof"),
    label,
    select,
    artwork,
    findings,
    summary,
  );
  fields.after(panel);

  let run,
    logo,
    verifiedLogo,
    revision = 0,
    paint = 0,
    timer;
  const checked = new Map();
  const key = (row) => row.source + "." + row.row;
  async function draw() {
    const token = ++paint;
    const row = run?.rows[select.selectedIndex];
    artwork.replaceChildren();
    findings.replaceChildren();
    if (!row) return;
    try {
      const font = await bundledFont();
      if (token !== paint || !panel.isConnected) return;
      if (logo !== verifiedLogo) {
        await verifyBadgeLogo(logo);
        if (token !== paint || !panel.isConnected) return;
        verifiedLogo = logo;
      }
      if (!row.person.role.trim()) throw Error("Choose a role for this badge.");
      if (
        ![row.appearance.foreground, row.appearance.background].every((color) =>
          /^#[a-fA-F0-9]{6}$/u.test(color),
        )
      )
        throw Error("Enter a six-digit hex value for both role colors.");
      const { svg, issues } = renderBadgeArtwork(
        row.person,
        run.settings,
        font,
        false,
        row.source === "spares",
        row.appearance,
        logo,
      );
      artwork.append(svg);
      const messages = new Set([...(checked.get(key(row)) ?? []), ...issues]);
      if (messages.size) {
        const list = element("ul");
        for (const message of messages) list.append(element("li", message));
        findings.append(list);
      } else findings.textContent = "This badge fits the print area.";
    } catch (error) {
      if (token === paint && panel.isConnected)
        findings.textContent = error.message;
    }
  }
  function rebuild() {
    if (!panel.isConnected) return;
    const selected = select.value;
    select.replaceChildren();
    try {
      const input = read();
      const invalid = fields.querySelector("input:invalid");
      if (invalid)
        throw Error(
          "Check " +
            (invalid.labels?.[0]?.textContent ?? "the print settings") +
            ".",
        );
      const people = (input.people ?? []).map((person) => ({
        name: person?.name ?? "",
        company: person?.company ?? "",
        role: person?.role ?? "",
      }));
      const spares = (input.spares ?? []).filter(
        (spare) => spare?.count > 0 && spare.role,
      );
      if (!people.length && !spares.length)
        throw Error("Add a person or a spare to preview a badge.");
      if (
        input.logo &&
        !/^data:image\/(?:png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/]+=*$/u.test(
          input.logo,
        )
      )
        throw Error("Choose an embedded PNG, JPEG, WebP or SVG logo.");
      logo = input.logo ?? null;
      // Keep zero-count spare rows in place so reported source row numbers stay stable.
      run = prepareBadgeRun({
        ...input,
        people,
        spares: (input.spares ?? []).map((spare) => ({
          role: spare?.role ?? "",
          count: spare?.role ? (spare.count ?? 0) : 0,
        })),
      });
      for (const row of run.rows) {
        const title =
          row.source === "people"
            ? row.row +
              " · " +
              (row.person.name || "Unnamed badge") +
              " · " +
              row.person.role
            : "Spare " + row.person.role + " · " + row.quantity + " copies";
        select.add(
          new Option(
            title + (checked.has(key(row)) ? " · needs attention" : ""),
            key(row),
          ),
        );
      }
      if ([...select.options].some((option) => option.value === selected))
        select.value = selected;
      if (checked.size && !checked.has(select.value))
        select.value = checked.keys().next().value;
      select.disabled = false;
      summary.textContent =
        run.pageCount +
        " " +
        (run.pageCount === 1 ? "page" : "pages") +
        " · " +
        run.widthMm +
        " × " +
        run.widthMm +
        " mm";
      void draw();
    } catch (error) {
      ++paint;
      run = undefined;
      select.disabled = true;
      artwork.replaceChildren();
      summary.textContent = "";
      findings.textContent = error.message;
    }
  }
  function changed() {
    ++revision;
    checked.clear();
    clearTimeout(timer);
    timer = setTimeout(rebuild, 100);
  }
  select.addEventListener("change", draw);
  fields.addEventListener("input", changed);
  const observer = new MutationObserver(changed);
  observer.observe(fields, { subtree: true, childList: true });
  rebuild();
  return {
    get revision() {
      return revision;
    },
    check(issues, submittedRevision) {
      if (revision !== submittedRevision) return;
      checked.clear();
      for (const item of issues) checked.set(key(item), item.messages);
      clearTimeout(timer);
      rebuild();
    },
    dispose() {
      ++paint;
      clearTimeout(timer);
      observer.disconnect();
      fields.removeEventListener("input", changed);
      panel.remove();
    },
  };
}
