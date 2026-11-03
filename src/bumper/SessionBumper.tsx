import React from "react";
import { z } from "zod";
import { AbsoluteFill, type CalculateMetadataFunction } from "remotion";
import { Corner, CORNER_DURATION, CORNER_IDLE_DURATION } from "./Corner";
import { Door, DOOR_DURATION, DOOR_IDLE_DURATION } from "./Door";
import { Lamp, LAMP_DURATION, LAMP_IDLE_DURATION } from "./Lamp";
import { Paper, PAPER_DURATION, PAPER_IDLE_DURATION } from "./Paper";

// SessionBumper: the OBS stinger that plays before "Waterhouse Sessions with
// Denzo". 1920 x 1080, 30 fps, rendered as VP9 webm with alpha. Where the
// live scene shows through, the frame is transparent - nothing is composited
// here. Four ideas on the same scaffolding; see Door.tsx, Corner.tsx,
// Lamp.tsx and Paper.tsx.

export const SessionBumperSchema = z.object({
  idea: z.enum(["door", "corner", "lamp", "paper"]),
  // null: "with Denzo"; a name: "with Denzo and <guest>".
  guestName: z.string().nullable(),
  // Render only the idle state (door: open door held; corner: the drift;
  // lamp: the lit mark; paper: the finished sheet), for a loop before the
  // stinger. Changes the duration.
  idle: z.boolean().optional(),
  // Studio only: a checkerboard behind the card so alpha is visible. Off by
  // default and never part of a delivered render.
  preview: z.boolean().optional(),
});

export type SessionBumperProps = z.infer<typeof SessionBumperSchema>;

export type BumperIdea = SessionBumperProps["idea"];
export const BUMPER_IDEAS: BumperIdea[] = ["door", "corner", "lamp", "paper"];

const DURATIONS: Record<BumperIdea, { full: number; idle: number }> = {
  door: { full: DOOR_DURATION, idle: DOOR_IDLE_DURATION },
  corner: { full: CORNER_DURATION, idle: CORNER_IDLE_DURATION },
  lamp: { full: LAMP_DURATION, idle: LAMP_IDLE_DURATION },
  paper: { full: PAPER_DURATION, idle: PAPER_IDLE_DURATION },
};

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

export const SessionBumper: React.FC<SessionBumperProps> = ({
  idea,
  guestName,
  idle = false,
  preview = false,
}) => {
  return (
    <AbsoluteFill>
      {preview ? <Checkerboard /> : null}
      {idea === "door" ? (
        <Door guestName={guestName} idle={idle} />
      ) : idea === "lamp" ? (
        <Lamp guestName={guestName} idle={idle} />
      ) : idea === "paper" ? (
        <Paper guestName={guestName} idle={idle} />
      ) : (
        <Corner guestName={guestName} idle={idle} />
      )}
    </AbsoluteFill>
  );
};
