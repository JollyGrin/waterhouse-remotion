import React from "react";

/**
 * The Waterhouse mark in its true proportions, straight from public/logo.svg.
 *
 * Deliberately NOT src/poster/markGeometry.ts — that geometry is a traced,
 * vertically stretched version matching the hand-made posters (aspect 1.06 against
 * the real logo's 1.50). The posters earn that distortion by being consistent with
 * eleven already published; the video has no such history, and the mark burned into
 * the stream is the real one, so a stretched mark beside it would read as wrong.
 */

export const MARK_VIEWBOX = { width: 1000, height: 666 };
export const MARK_ASPECT = MARK_VIEWBOX.width / MARK_VIEWBOX.height;

export const MARK_PATHS = [
  "M596.561 397.961L775.132 438.767V665.871H596.561V397.961Z",
  "M347.883 4.32837C347.883 2.64473 345.93 1.71445 344.622 2.77553L0.738724 281.917C0.270877 282.297 -0.000806451 282.867 -0.000806451 283.47V663.473C-0.000806451 664.577 0.894624 665.473 1.99919 665.473H345.883C346.987 665.473 347.883 664.577 347.883 663.473V4.32837Z",
  "M379.63 48.6704L685.184 149.002V287.521L379.629 204.41L379.63 48.6704Z",
  "M722.223 160.982L1000 252.329V372.878L722.223 297.628V160.982Z",
];

export const WhMark: React.FC<{
  color?: string;
  opacity?: number;
  style?: React.CSSProperties;
}> = ({ color = "#ffffff", opacity = 1, style }) => (
  <svg
    viewBox={`0 0 ${MARK_VIEWBOX.width} ${MARK_VIEWBOX.height}`}
    style={{ width: "100%", height: "100%", display: "block", opacity, ...style }}
  >
    {MARK_PATHS.map((d) => (
      <path key={d} d={d} fill={color} />
    ))}
  </svg>
);
