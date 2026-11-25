import assert from "node:assert/strict";
import test from "node:test";
import { planBadgeSheets } from "../dist/blocks/badge-sheets.mjs";
import { createToolkit } from "../dist/index.mjs";

const settings = {
  diameter: 80,
  bleed: 3,
  paper: "a4",
  sheetMargin: 5,
  cutMarks: true,
  doubleSided: true,
};

test("centered sheets preserve physical size, printer clearance and mirrored partial backs", () => {
  const plan = planBadgeSheets(settings, 7);
  assert.deepEqual(
    [plan.columns, plan.rows, plan.sheetCount, plan.pageCount],
    [2, 3, 2, 4],
  );
  assert.equal(plan.badgeSizeMm, 86);
  const [front, back, finalFront, finalBack] = plan.pages;
  assert.deepEqual(
    finalFront.slots.map((slot) => slot.badgeIndex),
    [6],
  );
  assert.equal(finalBack.slots[0].xMm, front.slots[1].xMm);
  assert.equal(
    front.slots[0].xMm,
    plan.widthMm - front.slots[1].xMm - plan.badgeSizeMm,
  );
  assert.equal(
    front.slots[0].yMm,
    plan.heightMm - front.slots[5].yMm - plan.badgeSizeMm,
  );
  for (const page of plan.pages) {
    for (const slot of page.slots) {
      assert.ok(
        slot.xMm - 4 >= settings.sheetMargin &&
          slot.yMm - 4 >= settings.sheetMargin,
      );
      assert.ok(slot.xMm + 86 + 4 <= plan.widthMm - settings.sheetMargin);
      assert.ok(slot.yMm + 86 + 4 <= plan.heightMm - settings.sheetMargin);
    }
  }
  for (const [face, reverse] of [
    [front, back],
    [finalFront, finalBack],
  ]) {
    assert.equal(reverse.sheetNumber, face.sheetNumber);
    for (const [i, slot] of face.slots.entries()) {
      assert.deepEqual(reverse.slots[i], {
        ...slot,
        xMm: plan.widthMm - slot.xMm - 86,
      });
    }
  }
});

test("cut marks consume gutter space and impossible margins are rejected", () => {
  assert.equal(
    planBadgeSheets({ ...settings, diameter: 100, bleed: 0 }, 3).columns,
    1,
  );
  assert.equal(
    planBadgeSheets(
      { ...settings, diameter: 100, bleed: 0, cutMarks: false },
      3,
    ).columns,
    2,
  );
  assert.throws(
    () => planBadgeSheets({ ...settings, diameter: 150, sheetMargin: 30 }, 1),
    /does not fit/,
  );
  assert.throws(
    () => planBadgeSheets({ ...settings, sheetMargin: -1 }, 1),
    /margin/,
  );
  assert.deepEqual(planBadgeSheets(settings, 0).pages, []);
  assert.equal(planBadgeSheets(settings, 4001).sheetCount, Math.ceil(4001 / 6));
  const single = planBadgeSheets(
    { diameter: 80, bleed: 3, doubleSided: true },
    3,
  );
  assert.deepEqual(
    [
      single.widthMm,
      single.heightMm,
      single.sheetCount,
      single.pageCount,
      single.cutMarks,
    ],
    [86, 86, 3, 6, false],
  );
});

test("preflight and PDF agree on A4 and Letter dimensions, duplex pages and spare badges", async () => {
  const kit = createToolkit({ enabled: ["badges"] });
  try {
    for (const [paper, width, height, capacity] of [
      ["a4", 210, 297, 6],
      ["letter", 215.9, 279.4, 4],
    ]) {
      const input = {
        settings: { ...settings, paper, shape: "square" },
        people: ["Amy", "Ben", "Chris", "Dee", "Eva", "Finn"].map((name) => ({
          name,
          role: "guest",
        })),
        spares: [{ role: "guest", count: 1 }],
      };
      const proof = await kit.run("badges_preflight", input);
      const pdf = await kit.run("badges_export_pdf", input);
      for (const result of [proof, pdf]) {
        assert.deepEqual(result.issues, []);
        assert.deepEqual(
          [
            result.paper,
            result.widthMm,
            result.heightMm,
            result.badgeSizeMm,
            result.perSheet,
            result.sheetCount,
            result.pageCount,
          ],
          [paper, width, height, 86, capacity, 2, 4],
        );
      }
      const bytes = Buffer.from(pdf.artifact.bytes).toString("latin1");
      const boxes = [
        ...bytes.matchAll(/\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/gu),
      ];
      assert.equal(boxes.length, 4);
      for (const box of boxes) {
        assert.ok(Math.abs((Number(box[1]) * 25.4) / 72 - width) < 0.5);
        assert.ok(Math.abs((Number(box[2]) * 25.4) / 72 - height) < 0.5);
      }
    }
  } finally {
    await kit.close();
  }
});
