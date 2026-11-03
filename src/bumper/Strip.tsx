import React from "react";
import { z } from "zod";
import { AbsoluteFill, Sequence } from "remotion";
import { HEIGHT, WIDTH, bodyFont } from "./shared";
import { SessionBumper, bumperDuration } from "./SessionBumper";

// A contact sheet of the bumper over a checkerboard: every `step` frames,
// in a grid, rendered as one still for docs/ and the PR. Each cell is the
// composition itself, offset with a negative Sequence so it shows frame k.

export const BumperStripSchema = z.object({
  idea: z.enum(["door", "corner", "lamp", "paper"]),
  guestName: z.string().nullable(),
  step: z.number().int().min(1),
  columns: z.number().int().min(1),
});

export type BumperStripProps = z.infer<typeof BumperStripSchema>;

export const STRIP_CELL_W = 480;
const LABEL_H = 28;
export const STRIP_CELL_H = (STRIP_CELL_W * HEIGHT) / WIDTH + LABEL_H;
const GAP = 8;

export function stripFrames(props: BumperStripProps): number[] {
  const duration = bumperDuration({ idea: props.idea });
  const frames: number[] = [];
  for (let f = 0; f < duration; f += props.step) frames.push(f);
  if (frames[frames.length - 1] !== duration - 1) frames.push(duration - 1);
  return frames;
}

export function stripSize(props: BumperStripProps): {
  width: number;
  height: number;
} {
  const n = stripFrames(props).length;
  const rows = Math.ceil(n / props.columns);
  return {
    width: props.columns * STRIP_CELL_W + (props.columns + 1) * GAP,
    height: rows * STRIP_CELL_H + (rows + 1) * GAP,
  };
}

export const BumperStrip: React.FC<BumperStripProps> = (props) => {
  const frames = stripFrames(props);
  const scale = STRIP_CELL_W / WIDTH;
  return (
    <AbsoluteFill style={{ background: "#2a2a2a" }}>
      {frames.map((f, i) => {
        const col = i % props.columns;
        const row = Math.floor(i / props.columns);
        return (
          <div
            key={f}
            style={{
              position: "absolute",
              left: GAP + col * (STRIP_CELL_W + GAP),
              top: GAP + row * (STRIP_CELL_H + GAP),
              width: STRIP_CELL_W,
              height: STRIP_CELL_H,
            }}
          >
            <div
              style={{
                width: WIDTH,
                height: HEIGHT,
                transform: `scale(${scale})`,
                transformOrigin: "0 0",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <Sequence from={-f} layout="none">
                <SessionBumper
                  idea={props.idea}
                  guestName={props.guestName}
                  preview
                />
              </Sequence>
            </div>
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                height: LABEL_H,
                lineHeight: `${LABEL_H}px`,
                fontFamily: bodyFont,
                fontSize: 16,
                color: "#ddd",
              }}
            >
              f{f}
            </div>
          </div>
        );
      })}
    </AbsoluteFill>
  );
};
