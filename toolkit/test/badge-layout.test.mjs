import assert from "node:assert/strict";
import test from "node:test";
import { withPrintPage } from "../dist/blocks/print-browser.mjs";

test("name bands use the space left by logos and attachments in proofs and print artwork", async () => {
  const layouts = await withPrintPage((page) =>
    page.evaluate(async () => {
      const { loadBadgeFont, prepareBadgeRun, renderBadgeArtwork } =
        await import("/badge-artwork.mjs");
      const font = await loadBadgeFont(
        await (await fetch("/font.ttf")).arrayBuffer(),
      );
      const logo =
        'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
      function layout(shape, attachment, withLogo, top = 14) {
        const {
          rows: [row],
          settings,
        } = prepareBadgeRun({
          people: [
            {
              name: "Alexandra\nPilar\nMartínez",
              role: "speaker",
              company: "Field Notes",
            },
          ],
          settings: {
            shape,
            ...(attachment ? { attachment } : {}),
            top,
            diameter: 100,
            bleed: 3,
            doubleSided: true,
          },
        });
        function render(preview) {
          const { svg, issues } = renderBadgeArtwork(
            row.person,
            settings,
            font,
            preview,
            false,
            row.appearance,
            withLogo ? logo : null,
          );
          return {
            issues,
            text: [...svg.querySelectorAll("text")].map((node) => [
              node.textContent,
              Number(node.getAttribute("font-size")),
              Number(node.getAttribute("y")),
            ]),
            exclusion: Boolean(
              svg.querySelector('[data-badge-guide="lanyard"]'),
            ),
            attachment: svg.dataset.badgeAttachment,
          };
        }
        return { preview: render(true), print: render(false) };
      }
      return ["circle", "rounded-square", "square"].map((shape) => ({
        original: layout(shape, undefined, true),
        noLogo: layout(shape, "lanyard", false),
        holder: layout(shape, "holder", true),
        holderNoLogo: layout(shape, "holder", false),
        holderWithStoredExclusion: layout(shape, "holder", false, 30),
      }));
    }),
  );
  for (const {
    original,
    noLogo,
    holder,
    holderNoLogo,
    holderWithStoredExclusion,
  } of layouts) {
    for (const { preview, print } of [
      original,
      noLogo,
      holder,
      holderNoLogo,
      holderWithStoredExclusion,
    ]) {
      assert.deepEqual(preview.issues, []);
      assert.deepEqual(print.issues, []);
      assert.deepEqual(preview.text, print.text);
      assert.equal(print.exclusion, false);
    }
    assert.equal(original.preview.attachment, "lanyard");
    assert.equal(original.preview.exclusion, true);
    assert.equal(holder.preview.exclusion, false);
    assert.equal(holderNoLogo.preview.exclusion, false);
    assert.deepEqual(
      holderWithStoredExclusion.preview.text,
      holderNoLogo.preview.text,
    );
    const name = original.preview.text[0];
    assert.ok(
      noLogo.preview.text[0][1] > name[1],
      "removing the logo permits larger type",
    );
    assert.ok(
      holder.preview.text[0][1] > name[1],
      "removing the lanyard exclusion permits larger type",
    );
    assert.ok(
      holderNoLogo.preview.text[0][2] < noLogo.preview.text[0][2],
      "holder can use the top space",
    );
  }
});
