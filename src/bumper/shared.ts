import { loadFont as loadJersey } from "@remotion/google-fonts/Jersey10";
import { loadFont as loadGrotesk } from "@remotion/google-fonts/SpaceGrotesk";
import { staticFile } from "remotion";

// Shared by both bumper ideas: fonts, palette, sound lookup, the card copy.

export const { fontFamily: brandFont } = loadJersey();
export const { fontFamily: bodyFont } = loadGrotesk("normal", {
  weights: ["400", "700"],
  subsets: ["latin"],
});

export const INK = "#111111";
export const PAPER = "#FFFFFF";
export const LIME = "#C6FF4A";
export const PURPLE = "#9146FF";

export const WIDTH = 1920;
export const HEIGHT = 1080;

export const HOST_NAME = "Denzo";

/** "with Denzo", or "with Denzo and <guest>". */
export function withLine(guestName: string | null): string {
  const guest = guestName?.trim();
  return guest ? `with ${HOST_NAME} and ${guest}` : `with ${HOST_NAME}`;
}

// One-shots from the two existing kits; no bed in a stinger.
export const pullupSfx = (name: string) =>
  staticFile(`audio/pullup/${name}.wav`);
export const recapSfx = (name: string) => staticFile(`audio/recap/${name}.wav`);
