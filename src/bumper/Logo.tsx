import React, { useId } from "react";

// The Waterhouse mark from public/logo.svg, split into its four paths so the
// bumpers can move each piece on its own. Coordinates are the SVG's own
// 1000 x 666 viewBox; `LogoPieces` is a <g> to drop into any SVG, `Logo`
// wraps it in an <svg> of a given width.

export const LOGO_VIEW_W = 1000;
export const LOGO_VIEW_H = 666;

export type LogoPiece = "house" | "beamA" | "beamB" | "pillar";

export const LOGO_PATHS: Record<LogoPiece, string> = {
  // The block with the roof peak at (347.9, 4.3) and its base on y = 665.
  house:
    "M347.883 4.32837C347.883 2.64473 345.93 1.71445 344.622 2.77553L0.738724 281.917C0.270877 282.297 -0.000806451 282.867 -0.000806451 283.47V663.473C-0.000806451 664.577 0.894624 665.473 1.99919 665.473H345.883C346.987 665.473 347.883 664.577 347.883 663.473V4.32837Z",
  beamA: "M379.63 48.6704L685.184 149.002V287.521L379.629 204.41L379.63 48.6704Z",
  beamB: "M722.223 160.982L1000 252.329V372.878L722.223 297.628V160.982Z",
  pillar: "M596.561 397.961L775.132 438.767V665.871H596.561V397.961Z",
};

export const LOGO_PIECE_ORDER: LogoPiece[] = ["house", "beamA", "beamB", "pillar"];

export interface PieceStyle {
  // CSS transform in the piece's own box (`transform-box: fill-box`).
  transform?: string;
  // Percentages or px, relative to the piece's box. Default centre.
  transformOrigin?: string;
  opacity?: number;
}

export interface Cutout {
  // In logo units. The house block is drawn with this rect removed, so
  // whatever is behind the logo shows through - the door's opening.
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LogoPiecesProps {
  color: string;
  pieces?: Partial<Record<LogoPiece, PieceStyle>>;
  houseCutout?: Cutout;
}

export const LogoPieces: React.FC<LogoPiecesProps> = ({
  color,
  pieces = {},
  houseCutout,
}) => {
  const maskId = useId();
  return (
    <g>
      {houseCutout ? (
        <defs>
          <mask id={maskId} maskUnits="userSpaceOnUse">
            <rect x={0} y={0} width={LOGO_VIEW_W} height={LOGO_VIEW_H} fill="#fff" />
            <rect
              x={houseCutout.x}
              y={houseCutout.y}
              width={houseCutout.w}
              height={houseCutout.h}
              fill="#000"
            />
          </mask>
        </defs>
      ) : null}
      {LOGO_PIECE_ORDER.map((piece) => {
        const s = pieces[piece] ?? {};
        return (
          <path
            key={piece}
            d={LOGO_PATHS[piece]}
            fill={color}
            mask={piece === "house" && houseCutout ? `url(#${maskId})` : undefined}
            style={{
              transformBox: "fill-box",
              transformOrigin: s.transformOrigin ?? "50% 50%",
              transform: s.transform,
              opacity: s.opacity,
            }}
          />
        );
      })}
    </g>
  );
};

interface LogoProps extends LogoPiecesProps {
  width: number;
  style?: React.CSSProperties;
}

/** The mark at `width` px; height follows the 1000:666 aspect. */
export const Logo: React.FC<LogoProps> = ({ width, style, ...rest }) => {
  return (
    <svg
      width={width}
      height={(width * LOGO_VIEW_H) / LOGO_VIEW_W}
      viewBox={`0 0 ${LOGO_VIEW_W} ${LOGO_VIEW_H}`}
      style={{ display: "block", overflow: "visible", ...style }}
    >
      <LogoPieces {...rest} />
    </svg>
  );
};
