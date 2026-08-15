// Post-deploy gate: loads every page of the LIVE site and fails the workflow
// if a mermaid block stayed raw, an asset 404'd, or the footer sha is not the
// commit this run deployed — the stale-CDN-edge case a human otherwise finds.
import { chromium } from "playwright";

const base = process.env.SITE_URL ?? "https://developerinlondon.github.io/neutron-authz/";
const sha = (process.env.EXPECT_SHA ?? "").slice(0, 8);
const pages = ["", "docs/", "docs/getting-started/", "docs/architecture/", "docs/comparison/",
  "docs/semantics/", "docs/conditions/", "docs/grants-and-bounds/", "docs/admin-surface/",
  "docs/building-a-ui/", "docs/cookbook/", "docs/storage-and-conformance/"];

const deadline = Date.now() + 8 * 60 * 1000;
let lastFailure = "did not run";

const browser = await chromium.launch();
const page = await browser.newPage();

while (Date.now() < deadline) {
  const failures = [];
  for (const path of pages) {
    const bad = [];
    const onResponse = (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); };
    page.on("response", onResponse);
    await page.goto(base + path, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000);
    const raw = await page.evaluate(() =>
      [...document.querySelectorAll("pre.mermaid")].filter((el) => !el.querySelector("svg")).length
    );
    if (raw > 0) bad.push(`${raw} raw mermaid block(s)`);
    if (sha) {
      const footer = await page.evaluate(() => document.querySelector("footer")?.textContent ?? "");
      if (!footer.includes(sha)) bad.push(`footer sha != ${sha}`);
    }
    page.off("response", onResponse);
    if (bad.length) failures.push(`${path || "/"}: ${bad.join("; ")}`);
  }
  if (failures.length === 0) {
    console.log(`live site verified: ${pages.length} pages, mermaid rendered, sha ${sha || "(unchecked)"}`);
    await browser.close();
    process.exit(0);
  }
  lastFailure = failures.join("\n");
  console.log(`not yet consistent, retrying:\n${lastFailure}`);
  await new Promise((r) => setTimeout(r, 30_000));
}
console.error(`live verification FAILED after 8m:\n${lastFailure}`);
await browser.close();
process.exit(1);
