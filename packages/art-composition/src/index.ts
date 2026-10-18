export const ART_STAGES = ["hatchling", "curious", "explorer", "veteran", "legend"] as const;
export type ArtStage = (typeof ART_STAGES)[number];

const palettes = [
  { body: "#54248c", quill: "#33115f", light: "#a878ef", ground: "#dad2ff", accent: "#ff68c8" },
  { body: "#49217e", quill: "#25104d", light: "#bb8aff", ground: "#d8e1fc", accent: "#ff80be" },
  { body: "#5d278d", quill: "#32115c", light: "#d098ff", ground: "#d4c9ff", accent: "#fd72d2" },
] as const;

const stageTitles: Record<ArtStage, string> = {
  hatchling: "Hatchling",
  curious: "Curious",
  explorer: "Explorer",
  veteran: "Veteran",
  legend: "Legend",
};

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index++) result = Math.imul(result ^ value.charCodeAt(index), 16777619);
  return result >>> 0;
}

function normalizedStage(stage: string): ArtStage {
  return ART_STAGES.includes(stage as ArtStage) ? stage as ArtStage : "hatchling";
}

export type ChogComposition = {
  svg: string;
  stage: ArtStage;
  traits: { name: string; value: string }[];
};

/** Deterministic original demo art based on the supplied Chog silhouette references. */
export function composeDemoChog(tokenId: string, requestedStage: string): ChogComposition {
  if (!/^(0|[1-9][0-9]{0,77})$/.test(tokenId)) throw new TypeError("Token ID must be a canonical unsigned integer");
  const stage = normalizedStage(requestedStage);
  const stageIndex = ART_STAGES.indexOf(stage);
  const paletteIndex = hash(tokenId) % palettes.length;
  const palette = palettes[paletteIndex]!;
  const hasCape = stageIndex >= 2;
  const hasCrown = stageIndex >= 3;
  const hasAura = stageIndex >= 4;
  const eyes = stageIndex >= 1 ? "Bright-eyed" : "Soft-eyed";
  const accessory = hasCrown ? "Star crown" : hasCape ? "Trail scarf" : "None";
  const traits = [
    { name: "Collection", value: "Chogins Demo" },
    { name: "Evolution", value: stageTitles[stage] },
    { name: "Quills", value: ["Deep violet", "Night purple", "Royal plum"][paletteIndex]! },
    { name: "Eyes", value: eyes },
    { name: "Accessory", value: accessory },
    { name: "Aura", value: hasAura ? "Comet glow" : "None" },
  ];
  const quills = Array.from({ length: 12 }, (_, index) => {
    const angle = (index * 30 - 135) * Math.PI / 180;
    const cx = 180 + Math.cos(angle) * 91;
    const cy = 174 + Math.sin(angle) * 85;
    const tipX = 180 + Math.cos(angle) * (index % 3 === 0 ? 158 : 144);
    const tipY = 174 + Math.sin(angle) * (index % 3 === 0 ? 153 : 137);
    const side = 21;
    const px = -Math.sin(angle) * side;
    const py = Math.cos(angle) * side;
    return `<path d="M ${cx - px} ${cy - py} Q ${tipX - px * .4} ${tipY - py * .4} ${tipX} ${tipY} Q ${tipX + px * .4} ${tipY + py * .4} ${cx + px} ${cy + py} Z" fill="${palette.quill}" stroke="#24103f" stroke-width="5" stroke-linejoin="round"/><path d="M ${cx} ${cy} Q ${tipX - px * .2} ${tipY - py * .2} ${tipX - 5} ${tipY + 11}" fill="none" stroke="${palette.light}" stroke-width="4" stroke-linecap="round" opacity=".8"/>`;
  }).join("");
  const stageArt = `${stageIndex >= 1 ? `<path d="M146 112 l3 -8 3 8 8 3 -8 3 -3 8 -3 -8 -8 -3z M214 112 l3 -8 3 8 8 3 -8 3 -3 8 -3 -8 -8 -3z" fill="#fff" opacity=".9"/>` : ""}${hasAura ? `<circle cx="180" cy="175" r="154" fill="none" stroke="${palette.accent}" stroke-width="8" stroke-dasharray="7 15" opacity=".72"/><path d="M43 162 Q20 151 35 134 M315 217 Q343 226 328 244" fill="none" stroke="${palette.accent}" stroke-width="7" stroke-linecap="round"/>` : ""}${hasCape ? `<path d="M94 237 Q68 264 82 311 L114 287 L138 319 L164 259 Z" fill="#fd72d2" stroke="#351452" stroke-width="6"/><path d="M102 260 L117 281" stroke="#ffe0f6" stroke-width="5" stroke-linecap="round"/>` : ""}${hasCrown ? `<path d="M143 64 L151 36 L171 56 L184 27 L198 56 L218 37 L220 66 Z" fill="#ffd35b" stroke="#492d71" stroke-width="5" stroke-linejoin="round"/><circle cx="184" cy="48" r="5" fill="#fff5c9"/>` : ""}`;
  const mouth = stageIndex >= 2
    ? `<path d="M144 208 Q180 228 216 208 Q209 230 180 232 Q151 229 144 208Z" fill="#683c31" stroke="#321b31" stroke-width="4" stroke-linejoin="round"/><path d="M155 214 Q180 220 205 214" fill="none" stroke="#f7a48e" stroke-width="4" stroke-linecap="round"/>`
    : `<path d="M151 211 Q180 221 209 211" fill="none" stroke="#66432f" stroke-width="6" stroke-linecap="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="360" viewBox="0 0 360 360" role="img" aria-label="Original Chogins demo character, ${stageTitles[stage]} stage"><defs><radialGradient id="bg"><stop stop-color="#fff"/><stop offset="1" stop-color="${palette.ground}"/></radialGradient><linearGradient id="body" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette.light}"/><stop offset=".42" stop-color="${palette.body}"/><stop offset="1" stop-color="${palette.quill}"/></linearGradient><linearGradient id="face" x1="0" y1="0" x2=".3" y2="1"><stop stop-color="#fff4d5"/><stop offset="1" stop-color="#e6c99d"/></linearGradient><filter id="shadow"><feGaussianBlur stdDeviation="7"/></filter></defs><rect width="360" height="360" rx="28" fill="url(#bg)"/><ellipse cx="181" cy="319" rx="94" ry="17" fill="#25123e" opacity=".16" filter="url(#shadow)"/>${stageArt}<g>${quills}<ellipse cx="180" cy="226" rx="83" ry="81" fill="url(#body)" stroke="#24103f" stroke-width="7"/><path d="M128 275 Q117 300 125 307 Q142 314 151 287 M208 287 Q217 314 235 307 Q243 297 231 275" fill="${palette.body}" stroke="#24103f" stroke-width="7" stroke-linecap="round"/><path d="M137 143 Q139 81 180 78 Q222 81 224 143 Q221 218 180 220 Q139 218 137 143Z" fill="url(#face)" stroke="#24103f" stroke-width="7"/><path d="M139 132 Q159 110 176 129 Q168 145 146 149Z" fill="#fff" stroke="#24103f" stroke-width="4"/><path d="M184 129 Q204 110 222 132 L215 149 Q193 145 184 129Z" fill="#fff" stroke="#24103f" stroke-width="4"/><ellipse cx="161" cy="138" rx="10" ry="14" fill="#130e19"/><ellipse cx="201" cy="138" rx="10" ry="14" fill="#130e19"/><circle cx="164" cy="133" r="4" fill="white"/><circle cx="204" cy="133" r="4" fill="white"/><path d="M142 122 Q160 113 175 121 M187 121 Q202 113 219 122" fill="none" stroke="#5a3a34" stroke-width="5" stroke-linecap="round"/><ellipse cx="181" cy="162" rx="13" ry="10" fill="${palette.accent}" stroke="#673456" stroke-width="4"/><path d="M176 161 Q181 166 186 161" fill="none" stroke="#7b355d" stroke-width="2"/>${mouth}<path d="M140 181 Q127 177 119 186 M220 181 Q233 177 241 186" fill="none" stroke="#dba09a" stroke-width="5" stroke-linecap="round" opacity=".55"/><path d="M158 87 Q180 74 202 87" fill="none" stroke="#fff8e7" stroke-width="5" stroke-linecap="round" opacity=".8"/></g><text x="180" y="345" text-anchor="middle" font-family="sans-serif" font-size="10" letter-spacing="2" fill="#41265f">CHOGINS DEMO · ${stageTitles[stage].toUpperCase()}</text></svg>`;
  return { svg, stage, traits };
}

export function artDataUri(tokenId: string, stage: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(composeDemoChog(tokenId, stage).svg)}`;
}
