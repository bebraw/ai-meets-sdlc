import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { zipSync, strToU8 } from "fflate";
import { getTalkGraphics, talkGraphicPackUrl } from "../site/talk-graphics.ts";
import {
  getPublishedTalks,
  publishedGraphicPackUrl,
} from "../site/published-talks.ts";

export const graphicsDirectory = "production/talk-graphics/2026";
export const graphicsRoot = path.resolve(import.meta.dirname, "..");
const sha = (value) => createHash("sha256").update(value).digest("hex");

export async function graphicInputVersion() {
  const files = [
    "scripts/talk-graphics.mjs",
    "site/talk-graphics.ts",
    "assets/logo.svg",
    "assets/fonts/FinlandicaHeadline-Black.woff2",
    "assets/fonts/FinlandicaText-Regular.woff2",
    "assets/fonts/FinlandicaText-Bold.woff2",
    ...getTalkGraphics().map((card) => card.photo.slice(1)),
  ];
  const inputs = await Promise.all(
    files.map(async (file) => [
      file,
      sha(await readFile(path.join(graphicsRoot, file))),
    ]),
  );
  return sha(JSON.stringify({ cards: getTalkGraphics(), inputs }));
}

function escape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// Code-native artwork keeps typography, wording and source references editable.
export function renderTalkGraphic(card, preset, assetUrl) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>${escape(card.headline)}</title><style>
@font-face {font-family:Headline;src:url("${assetUrl("/assets/fonts/FinlandicaHeadline-Black.woff2")}");font-weight:900}
@font-face {font-family:Text;src:url("${assetUrl("/assets/fonts/FinlandicaText-Regular.woff2")}");font-weight:400}
@font-face {font-family:Text;src:url("${assetUrl("/assets/fonts/FinlandicaText-Bold.woff2")}");font-weight:700}
*{box-sizing:border-box}html,body{margin:0;width:${preset.width}px;height:${preset.height}px}body{background:#101010;color:#f6f4ef;font-family:Text,sans-serif}
.card{height:100%;padding:40px;display:flex;flex-direction:column;gap:22px;background:radial-gradient(circle at 1px 1px,#f6f4ef12 1px,transparent 1.5px) 0 0/14px 14px}
.brand{display:flex;align-items:center;justify-content:space-between;height:48px;flex:none}.brand img{width:48px;height:48px}.brand p{margin:0;font-size:20px;font-weight:700;letter-spacing:2px}.brand span{color:#b7b0a4}
.main{display:grid;grid-template-columns:420px 1fr;gap:44px;flex:1;min-height:0;border-top:1px solid #f6f4ef70;padding-top:24px}.intro{min-width:0;display:flex;flex-direction:column;justify-content:space-between;gap:18px}
h1{font:900 50px/1.01 Headline,sans-serif;text-transform:uppercase;letter-spacing:-.3px;margin:0;max-width:100%}.speaker{display:grid;grid-template-columns:112px 1fr;gap:20px;align-items:end}.speaker-photo{width:112px;height:132px;object-fit:cover;object-position:center 24%;filter:grayscale(1);border:1px solid #f6f4ef70}.name{font-size:27px;font-weight:700;line-height:1.15;margin:0 0 12px}.title{font-size:18px;line-height:1.3;color:#b7b0a4;margin:0}
ol{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;min-width:0}.point{display:grid;grid-template-columns:40px 1fr;gap:16px;align-content:center;flex:1;border-bottom:1px solid #f6f4ef55;padding:14px 0;min-height:0}.point:first-child{padding-top:0}.point:last-child{border-bottom:0;padding-bottom:0}.number{font:900 28px/1 Headline,sans-serif;color:#b7b0a4;padding-top:3px}.point p{font-size:27px;line-height:1.22;margin:0}.time{display:block;font-size:17px;line-height:1.3;color:#b7b0a4;margin-top:9px;font-variant-numeric:tabular-nums}
footer{display:flex;justify-content:space-between;gap:20px;align-items:end;border-top:1px solid #f6f4ef70;padding-top:16px;flex:none}footer p{margin:0;font-size:18px;line-height:1.5}footer .source{font-size:22px;font-weight:700}footer .muted{color:#b7b0a4}
body.portrait .card{padding:64px;gap:34px}body.portrait .brand{height:72px}body.portrait .brand img{height:72px;width:72px}body.portrait .brand p{font-size:25px}
body.portrait .main{display:flex;flex-direction:column;gap:36px;padding-top:36px}body.portrait .intro{display:grid;grid-template-columns:1fr 220px;gap:30px;position:relative;min-height:280px}body.portrait h1{font-size:74px;line-height:1;grid-column:1;margin:0}body.portrait .speaker{display:contents}body.portrait .speaker-photo{grid-column:2;grid-row:1 / 3;width:220px;height:280px}body.portrait .speaker-text{grid-column:1}body.portrait .name{font-size:31px;margin-bottom:12px}body.portrait .title{font-size:23px;line-height:1.3}
body.portrait ol{flex:1}body.portrait .point{grid-template-columns:56px 1fr;gap:24px;padding:22px 0}body.portrait .number{font-size:40px}body.portrait .point p{font-size:36px;line-height:1.2}body.portrait .time{font-size:22px;margin-top:12px}body.portrait footer p{font-size:22px}body.portrait footer .source{font-size:27px}
</style><body class="${preset.id}"><article class="card"><div class="brand"><img src="${assetUrl("/assets/logo.svg")}" alt="SDLCAI"><p>2026 <span>/ TALK TAKEAWAYS</span></p></div><div class="main"><div class="intro"><h1 data-fit>${escape(card.headline)}</h1><div class="speaker"><img class="speaker-photo" style="object-position:${escape(card.photoPosition)}" src="${assetUrl(card.photo)}" alt="${escape(card.speaker)}"><div class="speaker-text"><p class="name" data-fit>${escape(card.speaker)}</p><p class="title" data-fit>${escape(card.title)}</p></div></div></div><ol>${card.points.map((point) => `<li class="point"><span class="number">${point.number}</span><div><p data-fit>${escape(point.text)}</p><span class="time">${escape(point.time)}</span></div></li>`).join("")}</ol></div><footer><p><span class="muted">Paraphrased from the talk</span><br>13 October 2026</p><p class="source">${escape(card.siteLabel)}</p></footer></article></body></html>`;
}

export async function copyTalkGraphics({ buildDir = "build" } = {}) {
  const base = path.join(graphicsRoot, graphicsDirectory);
  const manifest = JSON.parse(
    await readFile(path.join(base, "manifest.json"), "utf8"),
  );
  if (manifest.inputVersion !== (await graphicInputVersion()))
    throw new Error(
      "Talk graphics are stale. Run npm run talks:graphics:export and commit the exports.",
    );
  if (manifest.assets.length !== getTalkGraphics().length * 2)
    throw new Error("Incomplete takeaway graphics manifest");
  const archive = {};
  const publicArchive = {};
  const published = getPublishedTalks().items;
  for (const card of getTalkGraphics()) {
    const publicCard = published.find((item) => item.id === card.id);
    if (!publicCard) throw new Error(`Missing published graphic: ${card.id}`);
    for (const asset of card.assets) {
      const filename = `${card.id}-${asset.id}.png`;
      const data = await readFile(path.join(base, "exports", filename));
      const recorded = manifest.assets.find(
        (item) => item.filename === filename,
      );
      if (
        !recorded ||
        data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
        sha(data) !== recorded.sha256 ||
        data.readUInt32BE(16) !== asset.width ||
        data.readUInt32BE(20) !== asset.height ||
        data.length > 1_000_000
      )
        throw new Error(`Invalid takeaway graphic: ${filename}`);
      const destination = path.join(graphicsRoot, buildDir, asset.src.slice(1));
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(base, "exports", filename), destination);
      archive[filename] = data;
      const publicAsset = publicCard.graphic.assets.find(
        (item) => item.id === asset.id,
      );
      const publicDestination = path.join(
        graphicsRoot,
        buildDir,
        new URL(publicAsset.src, "https://sdlcai.org").pathname.slice(1),
      );
      await mkdir(path.dirname(publicDestination), { recursive: true });
      await writeFile(publicDestination, data);
      publicArchive[filename] = data;
    }
    const copy = strToU8(card.handoff);
    await writeFile(
      path.join(graphicsRoot, buildDir, card.copyUrl.slice(1)),
      copy,
    );
    archive[`${card.id}-copy.txt`] = copy;
    const publicCopy = strToU8(publicCard.graphic.copy);
    await writeFile(
      path.join(graphicsRoot, buildDir, publicCard.graphic.copyUrl.slice(1)),
      publicCopy,
    );
    publicArchive[`${card.id}-copy.txt`] = publicCopy;
  }
  const pack = path.join(graphicsRoot, buildDir, talkGraphicPackUrl.slice(1));
  await writeFile(pack, zipSync(archive));
  await writeFile(
    path.join(graphicsRoot, buildDir, publishedGraphicPackUrl.slice(1)),
    zipSync(publicArchive),
  );
  return manifest.assets.length;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  console.log(
    `Copied ${await copyTalkGraphics()} takeaway graphics into public talk pages and protected editorial previews.`,
  );
}
