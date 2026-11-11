import React from "react";
import { z } from "zod";
import { AbsoluteFill, type CalculateMetadataFunction } from "remotion";
import { Corner, CORNER_DURATION, CORNER_IDLE_DURATION } from "./Corner";
import { Door, DOOR_DURATION, DOOR_IDLE_DURATION } from "./Door";
import { Fader, FADER_DURATION, FADER_IDLE_DURATION } from "./Fader";
import { Flap, FLAP_DURATION, FLAP_IDLE_DURATION } from "./Flap";
import { Lamp, LAMP_DURATION, LAMP_IDLE_DURATION } from "./Lamp";
import { Neon, NEON_DURATION, NEON_IDLE_DURATION } from "./Neon";
import { Paper, PAPER_DURATION, PAPER_IDLE_DURATION } from "./Paper";
import { Vhs, VHS_DURATION, VHS_IDLE_DURATION, vhsDateStamp } from "./Vhs";

// SessionBumper: the OBS stinger that plays before "Waterhouse Sessions with
// Denzo". 1920 x 1080, 30 fps, rendered as VP9 webm with alpha. Where the
// live scene shows through, the frame is transparent - nothing is composited
// here. Eight ideas on the same scaffolding; see Door.tsx, Corner.tsx,
// Lamp.tsx, Paper.tsx, Neon.tsx, Vhs.tsx, Fader.tsx and Flap.tsx.

export const SessionBumperSchema = z.object({
  idea: z.enum(["door", "corner", "lamp", "paper", "neon", "vhs", "fader", "flap"]),
  // null: "with Denzo"; a name: "with Denzo and <guest>".
  guestName: z.string().nullable(),
  // Render only the idle state (door: open door held; corner: the drift;
  // lamp: the lit mark; paper: the finished sheet; neon: the lit sign in
  // the rain; vhs: the tape intro; fader: the strip with the fader up;
  // flap: the finished board), for a loop before the stinger. Changes the
  // duration.
  idle: z.boolean().optional(),
  // vhs only: the date the VCR burns in, bottom right ("NOV 03 2026"). The
  // render script passes the render date; the Studio shows today.
  vhsDate: z.string().optional(),
  // Studio only: a checkerboard behind the card so alpha is visible. Off by
  // default and never part of a delivered render.
  preview: z.boolean().optional(),
});

export type SessionBumperProps = z.infer<typeof SessionBumperSchema>;

export type BumperIdea = SessionBumperProps["idea"];
export const BUMPER_IDEAS: BumperIdea[] = ["door", "corner", "lamp", "paper", "neon", "vhs", "fader", "flap"];

const DURATIONS: Record<BumperIdea, { full: number; idle: number }> = {
  door: { full: DOOR_DURATION, idle: DOOR_IDLE_DURATION },
  corner: { full: CORNER_DURATION, idle: CORNER_IDLE_DURATION },
  lamp: { full: LAMP_DURATION, idle: LAMP_IDLE_DURATION },
  paper: { full: PAPER_DURATION, idle: PAPER_IDLE_DURATION },
  neon: { full: NEON_DURATION, idle: NEON_IDLE_DURATION },
  vhs: { full: VHS_DURATION, idle: VHS_IDLE_DURATION },
  fader: { full: FADER_DURATION, idle: FADER_IDLE_DURATION },
  flap: { full: FLAP_DURATION, idle: FLAP_IDLE_DURATION },
};

// Module load, so every frame of one render carries the same stamp.
const TODAY_STAMP = vhsDateStamp(new Date());

export function bumperDuration(props: {
  idea: BumperIdea;
  idle?: boolean;
}): number {
  const d = DURATIONS[props.idea];
  return props.idle ? d.idle : d.full;
}

export function bumperOutName(props: {
  idea: BumperIdea;
  idle?: boolean;
}): string {
  return `Bumper-${props.idea}${props.idle ? "-idle" : ""}.webm`;
}

export const calculateBumperMetadata: CalculateMetadataFunction<
  SessionBumperProps
> = ({ props }) => ({
  durationInFrames: bumperDuration(props),
  defaultCodec: "vp9",
  defaultPixelFormat: "yuva420p",
  defaultVideoImageFormat: "png",
  defaultOutName: bumperOutName(props),
});

// 48 px squares, two greys: reads as "transparent" to anyone who has used
// an image editor. Preview only.
const CHECKER_SIZE = 48;
const Checkerboard: React.FC = () => (
  <AbsoluteFill
    style={{
      backgroundColor: "#8a8a8a",
      backgroundImage:
        "repeating-conic-gradient(#bdbdbd 0% 25%, #8a8a8a 0% 50%)",
      backgroundSize: `${CHECKER_SIZE * 2}px ${CHECKER_SIZE * 2}px`,
    }}
  />
);

// `muted` is not in the schema: only BumperMatte sets it, on its second copy,
// so the sound plays once.
export const SessionBumper: React.FC<SessionBumperProps & { muted?: boolean }> = ({
  idea,
  guestName,
  idle = false,
  preview = false,
  vhsDate,
  muted = false,
}) => {
  return (
    <AbsoluteFill>
      {preview ? <Checkerboard /> : null}
      {idea === "door" ? (
        <Door guestName={guestName} idle={idle} muted={muted} />
      ) : idea === "lamp" ? (
        <Lamp guestName={guestName} idle={idle} muted={muted} />
      ) : idea === "paper" ? (
        <Paper guestName={guestName} idle={idle} muted={muted} />
      ) : idea === "neon" ? (
        <Neon guestName={guestName} idle={idle} muted={muted} />
      ) : idea === "vhs" ? (
        <Vhs guestName={guestName} idle={idle} muted={muted} date={vhsDate ?? TODAY_STAMP} />
      ) : idea === "fader" ? (
        <Fader guestName={guestName} idle={idle} muted={muted} />
      ) : idea === "flap" ? (
        <Flap guestName={guestName} idle={idle} muted={muted} />
      ) : (
        <Corner guestName={guestName} idle={idle} muted={muted} />
      )}
    </AbsoluteFill>
  );
};
