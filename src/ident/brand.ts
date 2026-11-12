import { loadFont as loadRubik } from "@remotion/google-fonts/RubikMonoOne";
import { loadFont as loadJet } from "@remotion/google-fonts/JetBrainsMono";

// Fonts — same families as landing / sessions / user-portal.
export const FONT_DISPLAY = loadRubik("normal", { subsets: ["latin"] }).fontFamily; // Rubik Mono One
export const FONT_MONO = loadJet("normal", { weights: ["500", "700", "800"], subsets: ["latin"] }).fontFamily; // JetBrains Mono

// Colour tokens, verbatim from waterhouse-sessions/src/styles/global.css and
// waterhouse-mono/apps/user-portal/tailwind.config.js.
export const C = {
  paper: "#faf6f6",
  gray: "#f3f4f6",
  ink: "#000000",
  yellow: "#FFD400", // caution, ::selection
  amber: "#ff8c1a",
  twitch: "#9146FF",
  punch: "#FF3B3B",
  mint: "#2ECC71",
} as const;

// Brutal border + offset shadow scale (px at 1x web; scale for 1080w video).
export const BORDER = 3;
export const SHADOW = { sm: 3, md: 6, lg: 10, xl: 14 } as const;

export const W = 1080;
export const H = 1920;
export const FPS = 30;

// The Waterhouse mark, viewBox 0 0 1000 666 (from waterhouse-landing/static/logo.svg).
// Four pieces: the house (tall left block with the roof point), two roof slats,
// and the bottom-right "door" pillar.
export const LOGO_VIEWBOX = { w: 1000, h: 666 };
export const LOGO_PATHS = {
  house:
    "M347.883 4.32837C347.883 2.64473 345.93 1.71445 344.622 2.77553L0.738724 281.917C0.270877 282.297 -0.000806451 282.867 -0.000806451 283.47V663.473C-0.000806451 664.577 0.894624 665.473 1.99919 665.473H345.883C346.987 665.473 347.883 664.577 347.883 663.473V4.32837Z",
  slatA: "M379.63 48.6704L685.184 149.002V287.521L379.629 204.41L379.63 48.6704Z",
  slatB: "M722.223 160.982L1000 252.329V372.878L722.223 297.628V160.982Z",
  door: "M596.561 397.961L775.132 438.767V665.871H596.561V397.961Z",
} as const;
export type LogoPiece = keyof typeof LOGO_PATHS;
export const LOGO_ORDER: LogoPiece[] = ["house", "slatA", "slatB", "door"];

// Copy.
export const COPY = {
  title1: "WATERHOUSE",
  title2: "SESSIONS",
  host: "WITH DENZO",
  day: "TUESDAY",
};

// Deterministic noise.
export const rand = (seed: number) => {
  const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};
