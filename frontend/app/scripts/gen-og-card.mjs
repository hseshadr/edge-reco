// One-off generator for the social/OG card (public/og-card.png, exactly 1200x630).
//
// Rasterizes an inline SVG to PNG via sharp (already a devDependency). The card
// is a clean branded panel: dark background, "EdgeReco" wordmark, the tagline,
// and a small footer line. Fonts are rendered as SVG <text> through librsvg;
// we keep to a common sans-serif stack so the wordmark renders on any host.
//
// Run: node scripts/gen-og-card.mjs   (from frontend/app)

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const APP_DIR = dirname(dirname(fileURLToPath(import.meta.url)));
const OUT = join(APP_DIR, "public", "og-card.png");

const W = 1200;
const H = 630;
const BG = "#0b0f17";
const ACCENT = "#ff4d2e";
const FG = "#f5f7fb";
const MUTED = "#9aa6b8";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${ACCENT}"/>
  <g font-family="Helvetica, Arial, 'DejaVu Sans', sans-serif">
    <text x="80" y="250" font-size="120" font-weight="700" fill="${FG}">Edge<tspan fill="${ACCENT}">Reco</tspan></text>
    <text x="80" y="340" font-size="44" font-weight="500" fill="${FG}">Search &amp; recommendations that run</text>
    <text x="80" y="400" font-size="44" font-weight="500" fill="${FG}">on the shopper's device</text>
    <text x="80" y="560" font-size="30" font-weight="400" fill="${MUTED}">edge-reco.com  ·  open source</text>
  </g>
</svg>`;

const out = await sharp(Buffer.from(svg)).png().toFile(OUT);
const meta = await sharp(OUT).metadata();
process.stdout.write(
	`>> og-card written: ${OUT}\n>> ${meta.width}x${meta.height} ${out.format} (${out.size} bytes)\n`,
);
