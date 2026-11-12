import React from "react";
import { AbsoluteFill, Audio, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C, FONT_DISPLAY, FONT_MONO, H, W } from "./brand";
import { Grain } from "./common";
import {
  ALPH,
  BIG,
  BOOM,
  CW,
  EXIT0,
  EXIT1,
  FMAX,
  FMIN,
  FS,
  KICKS,
  LC0,
  LC1,
  LOGO_H_PX,
  NCOL,
  PF,
  P_LOGO_TOP,
  ROW_PX,
  SPEC,
  TAPE_ROWS,
  V,
} from "./spectro/data";
import { HIST, HIST_PRE, MSUB, PK, RMS } from "./spectro/wide-data";

/**
 * SPECTRO: the mark is hidden in the sound's spectrogram (after "Windowlicker").
 * A studio analyser: live spectrum on top, a scrolling waterfall below (newest row at the
 * write head, history flowing down). Everything in the waterfall is a real multi-resolution
 * STFT of the exact mix you hear (src/ident/spectro/gen-audio.py): hiss and mains hum, kicks punching
 * bars across, a sine sweep drawing a diagonal, then the mark written in ~110 partials (a Dm9
 * cluster), bottom row first, so it slides out of the write head upright. The scroll brakes and
 * holds with the mark framed; the camera pushes into the bins until they go chunky. The title
 * lights up bin by bin. Exit: a low-pass closes the spectrum, and the analyser's columns drop out
 * from the top end down, revealing the content.
 *
 * Grid: 120 bpm, beat = 15 f, downbeats on 10 + 15k.
 *
 * 16:9 (SpectroWide): the same analyser, the same tape, the same audio. The waterfall keeps its
 * SDR-style orientation (frequency across, time falling down), because the mix writes the mark
 * with frequency on its horizontal axis: a DAW-style horizontal scroll would show it transposed.
 * The analyser becomes a panel on the left; a side column carries what the portrait had no room
 * for: peak/RMS meters and a loudness history measured from the same mix (src/ident/spectro/gen-wide.py),
 * and the title. The push stays inside the panel, so the mark and both marker brackets stay framed.
 */
export const SPECTRO_FRAMES = 140;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const heavy = Easing.bezier(0.65, 0, 0.25, 1);

// ---- layout (analyser space = screen space at camera scale 1) ----
const ANA_W = NCOL * CW; // 1080: the analyser's own width
const LOGO_X0 = LC0 * CW; // 144
const LOGO_X1 = LC1 * CW; // 936
const TITLE_T = [85, 89]; // WATERHOUSE, SESSIONS
const RULE = 93;
const SUB = 96;
const DROP_LEN = 3;

type Layout = {
  wide: boolean;
  W: number;
  H: number;
  AX0: number; // screen x of analyser x = 0 at camera scale 1
  Y_TOP: number; // write head
  SPEC_BASE: number; // live spectrum baseline
  SPEC_H: number;
  PUSH: number; // camera push into the bins
  PUSH_Y: number; // screen y the mark's centre travels to during the push
  HIST_DIM: string; // persistence: older history dims
};

const PORTRAIT: Layout = {
  wide: false,
  W,
  H,
  AX0: 0,
  Y_TOP: 350,
  SPEC_BASE: 318,
  SPEC_H: 150,
  PUSH: 0.3,
  PUSH_Y: 672,
  HIST_DIM: "linear-gradient(180deg, rgba(4,4,4,0) 0px, rgba(4,4,4,0) 820px, rgba(4,4,4,0.55) 1250px, rgba(4,4,4,0.85) 1600px)",
};

const WW = 1920;
const WH = 1080;
const PANEL_R = 1190; // the analyser panel's right edge (screen); the side column starts here
const SIDE_X = 1236; // side column content left edge
const SAFE_R = WW - 96; // title-safe right edge (5%)
const WIDE: Layout = {
  wide: true,
  W: WW,
  H: WH,
  AX0: 110,
  Y_TOP: 250,
  SPEC_BASE: 216,
  SPEC_H: 112,
  PUSH: 0.2,
  PUSH_Y: 622,
  HIST_DIM: "linear-gradient(180deg, rgba(4,4,4,0) 0px, rgba(4,4,4,0) 660px, rgba(4,4,4,0.5) 860px, rgba(4,4,4,0.8) 1040px)",
};

const xOfF = (f: number) => (NCOL * CW * Math.log(f / FMIN)) / Math.log(FMAX / FMIN);
const fmtHz = (f: number) => (f >= 1000 ? `${(f / 1000).toFixed(1).replace(/\.0$/, "")} kHz` : `${Math.round(f)} Hz`);
const F_LO = FMIN * Math.pow(FMAX / FMIN, LC0 / NCOL);
const F_HI = FMIN * Math.pow(FMAX / FMIN, LC1 / NCOL);

const specAt = (f: number) => {
  const s = SPEC[Math.max(0, Math.min(SPEC.length - 1, f))];
  const out = new Array<number>(NCOL);
  for (let i = 0; i < NCOL; i++) out[i] = ALPH.indexOf(s[i]) / 63;
  return out;
};

// tape position of any frame (pre-roll frames scroll at V)
const tapeP = (f: number) => (f < 0 ? PF[0] + V * f : PF[Math.min(PF.length - 1, Math.round(f))]);

// exit: column i starts dropping when the low-pass cutoff passes it (same curve as the audio)
const dropStart = (i: number) => {
  const v = Math.min(1, Math.max(0, 1 - (i + 0.5 - 3) / NCOL));
  return EXIT0 + (EXIT1 - EXIT0) * Math.pow(v, 1 / 1.7);
};

const decay = (t: number, k: number) => (t >= 0 ? Math.exp(-t / k) : 0);

const SUBTXT = "WITH DENZO · TUESDAY";

const SpectroView: React.FC<{ L: Layout }> = ({ L }) => {
  const f = useCurrentFrame();
  const { Y_TOP, SPEC_BASE, SPEC_H } = L;

  // ---- camera: inertial push into the bins once the scroll holds ----
  const push = interpolate(f, [84, 114], [0, 1], { ...clamp, easing: heavy });
  const drift = interpolate(f, [114, 140], [0, 1], clamp);
  let s = 1 + L.PUSH * push + 0.035 * drift;
  // kick weight: a short squeeze, no bounce
  for (const k of KICKS) s += 0.004 * decay(f - k, 3);
  for (const k of BIG) s += 0.01 * decay(f - k, 4);
  s += 0.012 * decay(f - BOOM, 5);
  const logoTopScreen = Y_TOP + PF[Math.min(f, PF.length - 1)] - P_LOGO_TOP; // analyser y of the mark's top
  const holdTop = Y_TOP + PF[PF.length - 1] - P_LOGO_TOP;
  const cy0 = holdTop + LOGO_H_PX / 2; // the mark's centre once it holds
  const cyT = interpolate(push, [0, 1], [cy0, L.PUSH_Y]);
  const cx = L.AX0 + ANA_W / 2; // screen x of the analyser's centre
  const cam = `translate(${cx}px, ${cyT}px) scale(${s}) translate(${-ANA_W / 2}px, ${-cy0}px)`;

  // ---- power-on ----
  const on = f < 1 ? 0 : f < 2 ? 0.55 : f < 3 ? 0.3 : interpolate(f, [3, 7], [0.75, 1], clamp);
  const hold = f >= FS - 0.5;

  // ---- tape placement ----
  const P = PF[Math.min(f, PF.length - 1)];
  const tapeTop = Y_TOP + Math.round(P) - TAPE_ROWS * ROW_PX;

  // ---- sharpen as the camera closes in ----
  const contrast = 1 + 0.45 * push;
  const cells = 0.6 * push;

  // ---- live spectrum with peak hold ----
  const cur = specAt(f);
  const peaks = new Array<number>(NCOL).fill(0);
  for (let k = 0; k < 14; k++) {
    if (f - k < 0) break;
    const v = specAt(f - k);
    for (let i = 0; i < NCOL; i++) peaks[i] = Math.max(peaks[i], v[i] - 0.028 * k);
  }
  let bars = "";
  let ticks = "";
  for (let i = 0; i < NCOL; i++) {
    const h = Math.max(0, cur[i]) * SPEC_H;
    if (h > 0.5) bars += `M${i * CW + 1} ${SPEC_BASE}h${CW - 2}v${-h.toFixed(1)}h${-(CW - 2)}z`;
    const p = peaks[i] * SPEC_H;
    if (p > 2) ticks += `M${i * CW + 1} ${(SPEC_BASE - p).toFixed(1)}h${CW - 2}v2h${-(CW - 2)}z`;
  }

  // ---- beat ticks on the waterfall's left edge, scrolling with the tape ----
  // portrait: over the waterfall's low end; 16:9: a time ruler in the margin left of the panel
  const beatTicks: React.ReactNode[] = [];
  for (let b = 10 - 15 * 8; b <= Math.min(f, 140); b += 15) {
    const y = Y_TOP + P - tapeP(b);
    if (y < Y_TOP || y > L.H) continue;
    const n = Math.round((b - 10) / 15);
    const bar = Math.floor(n / 4) + 2;
    const beat = (((n % 4) + 4) % 4) + 1;
    beatTicks.push(
      L.wide ? (
        <g key={b} opacity={0.55}>
          <rect x={beat === 1 ? -24 : -14} y={y - 1} width={beat === 1 ? 22 : 12} height={2} fill="#bdbdbd" />
          {beat === 1 ? (
            <text x={-32} y={y + 6} fill="#8d8d8d" fontFamily={FONT_MONO} fontSize={17} fontWeight={500} textAnchor="end">
              {bar}.1
            </text>
          ) : null}
        </g>
      ) : (
        <g key={b} opacity={0.55}>
          <rect x={0} y={y - 1} width={beat === 1 ? 22 : 12} height={2} fill="#bdbdbd" />
          {beat === 1 ? (
            <text x={28} y={y + 6} fill="#8d8d8d" fontFamily={FONT_MONO} fontSize={17} fontWeight={500}>
              {bar}.1
            </text>
          ) : null}
        </g>
      ),
    );
  }

  // ---- marker brackets once the mark holds ----
  const mkA = interpolate(f, [FS - 1, FS + 2], [0, 1], clamp);
  const mkS = interpolate(f, [FS - 1, FS + 3], [1.04, 1], { ...clamp, easing: Easing.out(Easing.cubic) });
  const mTop = logoTopScreen - 22;
  const mBot = logoTopScreen + LOGO_H_PX + 22;
  const mL = LOGO_X0 - 22;
  const mR = LOGO_X1 + 22;
  const arm = 34;
  const mcx = (mL + mR) / 2;
  const mcy = (mTop + mBot) / 2;

  // ---- title: bins light from the low end up ----
  const binWipe = (t0: number, len = 6) => interpolate(f, [t0, t0 + len], [0, 100], clamp);
  const w1 = binWipe(TITLE_T[0]);
  const w2 = binWipe(TITLE_T[1]);
  const stepClip = (pct: number) => {
    const q = Math.floor(pct / 4) * 4; // stepped, one bin at a time
    return `inset(0 ${100 - q}% 0 0)`;
  };
  const ruleW = interpolate(f, [RULE, RULE + 5], [0, 128], { ...clamp, easing: Easing.out(Easing.cubic) });
  const subChars = Math.floor(interpolate(f, [SUB, SUB + 10], [0, SUBTXT.length], clamp));
  const titleBack = interpolate(f, [TITLE_T[0] - 3, TITLE_T[0] + 3], [0, 1], clamp);

  // ---- exit: columns drop out, top end first ----
  const xs = (i: number) => cx + s * (i * CW - ANA_W / 2);
  const fall = (t0: number) => {
    const u = Math.min(1, Math.max(0, (f - t0) / DROP_LEN));
    return (u * u * (L.H + 40)).toFixed(1);
  };
  let clip: string | undefined;
  if (f >= EXIT0 - (L.wide ? 5 : 0)) {
    const pts: string[] = [];
    if (!L.wide) {
      pts.push(`${xs(0).toFixed(1)}px ${H + 40}px`);
      for (let i = 0; i < NCOL; i++) {
        const y = fall(dropStart(i));
        pts.push(`${xs(i).toFixed(1)}px ${y}px`, `${xs(i + 1).toFixed(1)}px ${y}px`);
      }
      pts.push(`${xs(NCOL).toFixed(1)}px ${H + 40}px`);
    } else {
      // the whole wide frame as strips: the ruler margin goes with column 0, the analyser columns
      // follow the audio's low-pass exactly, and the side column runs ahead of them from the right edge
      pts.push(`0px ${WH + 40}px`);
      const x0 = Math.max(0, xs(0));
      if (x0 > 0) {
        const y = fall(dropStart(0));
        pts.push(`0px ${y}px`, `${x0.toFixed(1)}px ${y}px`);
      }
      let lastI = 0;
      for (let i = 0; i < NCOL; i++) {
        const a = xs(i);
        const b = Math.min(xs(i + 1), PANEL_R);
        if (b <= 0) continue;
        if (a >= PANEL_R) break;
        const y = fall(dropStart(i));
        pts.push(`${Math.max(0, a).toFixed(1)}px ${y}px`, `${b.toFixed(1)}px ${y}px`);
        lastI = i;
      }
      const tSeam = dropStart(lastI + 1);
      const tEdge = EXIT0 - 5;
      const SW = 12;
      for (let x = PANEL_R; x < WW; x += SW) {
        const t0 = tSeam + ((tEdge - tSeam) * (x - PANEL_R)) / (WW - PANEL_R);
        const y = fall(t0);
        pts.push(`${x.toFixed(1)}px ${y}px`, `${Math.min(WW, x + SW).toFixed(1)}px ${y}px`);
      }
      pts.push(`${WW}px ${WH + 40}px`);
    }
    clip = `polygon(${pts.join(",")})`;
  }
  const allGone = f >= EXIT1 + DROP_LEN;

  const labels = [50, 100, 200, 500, 1000, 2000, 5000, 10000];
  const major = new Set([100, 1000, 10000]);

  const readoutStyle: React.CSSProperties = {
    position: "absolute",
    fontFamily: FONT_MONO,
    fontSize: 19,
    fontWeight: 500,
    color: "#9a9a9a",
    letterSpacing: 2,
    lineHeight: "30px",
  };

  const analyser = (
    <AbsoluteFill style={{ transform: cam, transformOrigin: "0 0", opacity: on }}>
      {/* screen glow */}
      {L.wide ? (
        <div
          style={{
            position: "absolute",
            left: -L.AX0,
            top: 0,
            width: WW,
            height: WH,
            background: "radial-gradient(ellipse 48% 62% at 34% 42%, #101010 0%, #070707 60%, #030303 100%)",
          }}
        />
      ) : (
        <AbsoluteFill
          style={{ background: "radial-gradient(ellipse 90% 55% at 50% 35%, #101010 0%, #070707 60%, #030303 100%)" }}
        />
      )}
      {/* waterfall */}
      <div style={{ position: "absolute", left: 0, top: Y_TOP, width: ANA_W, height: L.H - Y_TOP + 400, overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: tapeTop - Y_TOP, width: ANA_W, height: TAPE_ROWS * ROW_PX }}>
          <Img
            src={staticFile("ident/spectro/tape.png")}
            style={{
              position: "absolute",
              width: ANA_W,
              height: TAPE_ROWS * ROW_PX,
              imageRendering: "pixelated",
              filter: `contrast(${contrast})`,
            }}
          />
          {/* bloom */}
          <Img
            src={staticFile("ident/spectro/tape.png")}
            style={{
              position: "absolute",
              width: ANA_W,
              height: TAPE_ROWS * ROW_PX,
              filter: "blur(9px) brightness(1.3)",
              mixBlendMode: "screen",
              opacity: 0.4,
            }}
          />
          {/* bin cells: visible once the camera is close */}
          {cells > 0.01 ? (
            <div
              style={{
                position: "absolute",
                inset: 0,
                opacity: cells,
                backgroundImage: `repeating-linear-gradient(90deg, rgba(0,0,0,0.85) 0 1px, transparent 1px ${CW}px), repeating-linear-gradient(0deg, rgba(0,0,0,0.85) 0 1px, transparent 1px ${ROW_PX}px)`,
                backgroundPosition: `0 ${(TAPE_ROWS * ROW_PX) % ROW_PX}px`,
              }}
            />
          ) : null}
        </div>
        {/* persistence: older history dims */}
        <div style={{ position: "absolute", inset: 0, background: L.HIST_DIM }} />
      </div>

      <svg width={ANA_W} height={L.H} style={{ position: "absolute", left: 0, top: 0, overflow: "visible" }}>
        {/* frequency grid */}
        {labels.map((hz) => (
          <rect
            key={hz}
            x={xOfF(hz)}
            y={SPEC_BASE - SPEC_H - 6}
            width={1}
            height={L.H}
            fill="#ffffff"
            opacity={major.has(hz) ? 0.1 : 0.05}
          />
        ))}
        {/* live spectrum */}
        <path d={bars} fill="#eeeeee" opacity={0.9} />
        <path d={ticks} fill="#9a9a9a" />
        <rect x={0} y={SPEC_BASE} width={ANA_W} height={1} fill="#5a5a5a" />
        {/* axis labels */}
        {labels.map((hz) => (
          <text
            key={`l${hz}`}
            x={xOfF(hz) + 5}
            y={SPEC_BASE + 22}
            fill={major.has(hz) ? "#b8b8b8" : "#7a7a7a"}
            fontFamily={FONT_MONO}
            fontSize={17}
            fontWeight={500}
          >
            {hz >= 1000 ? `${hz / 1000}k` : hz}
          </text>
        ))}
        {/* write head */}
        <rect x={0} y={Y_TOP - 1} width={ANA_W} height={2} fill="#d8d8d8" opacity={0.75} />
        <rect x={0} y={Y_TOP - 5} width={ANA_W} height={10} fill="#ffffff" opacity={0.05} />
        {beatTicks}
        {/* marker */}
        <g opacity={mkA} transform={`translate(${mcx} ${mcy}) scale(${mkS}) translate(${-mcx} ${-mcy})`}>
          <path
            d={`M${mL} ${mTop + arm}V${mTop}H${mL + arm} M${mR - arm} ${mTop}H${mR}V${mTop + arm} M${mR} ${mBot - arm}V${mBot}H${mR - arm} M${mL + arm} ${mBot}H${mL}V${mBot - arm}`}
            stroke="#e6e6e6"
            strokeWidth={2.5}
            fill="none"
          />
          <rect x={mL - 6} y={mTop - 40} width={470} height={34} fill="#040404" opacity={0.92} />
          <text x={mL} y={mTop - 16} fill="#a8a8a8" fontFamily={FONT_MONO} fontSize={18} fontWeight={500} letterSpacing={1.5}>
            {`MKR A   ${fmtHz(F_LO)} – ${fmtHz(F_HI)}   Δt ${(LOGO_H_PX / V / 30).toFixed(2)} s`}
          </text>
        </g>
      </svg>

      {L.wide ? null : (
        <>
          {/* readouts */}
          <div style={{ ...readoutStyle, left: 44, top: 64 }}>
            <div style={{ color: "#d0d0d0", fontWeight: 700 }}>SPECTRUM · WATERFALL</div>
            <div>MULTI-RES FFT 1k–8k · HANN</div>
          </div>
          <div style={{ ...readoutStyle, right: 44, top: 64, textAlign: "right" }}>
            <div style={{ color: "#d0d0d0", fontWeight: 700 }}>{hold ? "■ HOLD" : "● RUN"}</div>
            <div>120 BPM</div>
          </div>
          <Grain opacity={0.07} blend="screen" />
        </>
      )}
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill>
      <Audio src={staticFile("ident/audio/spectro/mix.wav")} />
      {allGone ? null : (
        <AbsoluteFill style={{ clipPath: clip }}>
          <AbsoluteFill style={{ backgroundColor: "#040404" }} />
          {L.wide ? (
            <>
              {/* the push happens inside the panel */}
              <AbsoluteFill style={{ clipPath: `inset(0 ${WW - PANEL_R}px 0 0)` }}>{analyser}</AbsoluteFill>
              <SideColumn f={f} on={on} hold={hold} w1={w1} w2={w2} ruleW={ruleW} subChars={subChars} stepClip={stepClip} />
              <Grain opacity={0.07} blend="screen" />
            </>
          ) : (
            analyser
          )}

          {/* title, screen space */}
          {!L.wide && f >= TITLE_T[0] - 3 ? (
            <AbsoluteFill>
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  top: 1050,
                  width: W,
                  height: 420,
                  opacity: titleBack,
                  background: "linear-gradient(180deg, rgba(4,4,4,0) 0%, rgba(4,4,4,0.88) 22%, rgba(4,4,4,0.88) 78%, rgba(4,4,4,0) 100%)",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  top: 1110,
                  width: W,
                  textAlign: "center",
                  fontFamily: FONT_DISPLAY,
                  fontSize: 76,
                  letterSpacing: 6,
                  color: C.paper,
                  clipPath: stepClip(w1),
                }}
              >
                WATERHOUSE
              </div>
              <div
                style={{
                  position: "absolute",
                  top: 1200,
                  width: W,
                  textAlign: "center",
                  fontFamily: FONT_DISPLAY,
                  fontSize: 76,
                  letterSpacing: 6,
                  color: "#8f8f8f",
                  clipPath: stepClip(w2),
                }}
              >
                SESSIONS
              </div>
              <div style={{ position: "absolute", top: 1306, left: W / 2 - ruleW / 2, width: ruleW, height: 5, backgroundColor: C.yellow }} />
              <div
                style={{
                  position: "absolute",
                  top: 1336,
                  width: W,
                  textAlign: "center",
                  fontFamily: FONT_MONO,
                  fontWeight: 700,
                  fontSize: 25,
                  letterSpacing: 7,
                  color: "#bdbdbd",
                  whiteSpace: "pre",
                }}
              >
                {SUBTXT.slice(0, subChars).padEnd(SUBTXT.length, " ")}
              </div>
            </AbsoluteFill>
          ) : null}
        </AbsoluteFill>
      )}
    </AbsoluteFill>
  );
};

// ---- 16:9 side column: meters + loudness history from the same mix, then the title ----
const M_TOP = 330; // meter scale top (0 dBFS)
const M_BOT = 920; // meter scale bottom (-60 dBFS)
const DB_MIN = -60;
const yOfDb = (d: number) => M_BOT - ((Math.max(DB_MIN, Math.min(0, d)) - DB_MIN) / -DB_MIN) * (M_BOT - M_TOP);
const TITLE_X = 1344;
const TITLE_PX = 50;
const TITLE_Y = 500;
const G_X0 = TITLE_X; // loudness graph
const G_X1 = SAFE_R;
const G_TOP = 812;
const G_BOT = M_BOT;
const G_SPAN = 60; // frames of history shown

const pad2 = (n: number) => String(n).padStart(2, "0");
// bar.beat.16th on the 120 bpm grid (downbeat of bar 2 on frame 10, as on the ruler)
const pos = (f: number) => {
  const t = f - 10;
  const n = Math.floor(t / 15);
  const bar = Math.floor(n / 4) + 2;
  const beat = (((n % 4) + 4) % 4) + 1;
  const six = Math.floor((((t % 15) + 15) % 15) / 3.75) + 1;
  return `${String(bar).padStart(3, "0")}.${beat}.${six}`;
};
const tc = (f: number) => `00:00:${pad2(Math.floor(f / 30))}:${pad2(f % 30)}`;

const histAt = (k: number) => (k < 0 ? HIST_PRE : HIST[Math.min(HIST.length - 1, k)]);

const SideColumn: React.FC<{
  f: number;
  on: number;
  hold: boolean;
  w1: number;
  w2: number;
  ruleW: number;
  subChars: number;
  stepClip: (pct: number) => string;
}> = ({ f, on, hold, w1, w2, ruleW, subChars, stepClip }) => {
  const fi = Math.max(0, Math.min(PK.length - 1, f));
  // peak meter: instant attack, 18 dB/s fall; hold line for 1.5 s
  let pk = -120;
  let pkHold = -120;
  for (let k = 0; k <= 45; k++) {
    if (f - k < 0) break;
    const v = PK[Math.min(PK.length - 1, f - k)];
    pk = Math.max(pk, v - 0.6 * k);
    pkHold = Math.max(pkHold, v);
  }
  const rms = RMS[fi];
  const live = f >= 1;

  // loudness history, newest at the right
  const N = G_SPAN * MSUB;
  const kNow = (fi + 1) * MSUB - 1;
  const gy = (d: number) => G_BOT - ((Math.max(DB_MIN, Math.min(0, d)) - DB_MIN) / -DB_MIN) * (G_BOT - G_TOP);
  let line = "";
  for (let j = 0; j <= N; j++) {
    const x = G_X1 - ((N - j) / N) * (G_X1 - G_X0);
    const y = gy(histAt(kNow - (N - j)));
    line += `${j === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  const area = `${line}L${G_X1} ${G_BOT}L${G_X0} ${G_BOT}Z`;

  const meterBar = (x: number, d: number) => (
    <>
      <rect x={x} y={M_TOP} width={14} height={M_BOT - M_TOP} fill="#121212" />
      <rect x={x} y={yOfDb(d)} width={14} height={M_BOT - yOfDb(d)} fill="url(#seg)" />
    </>
  );
  const scale = [0, -6, -12, -24, -36, -48, -60];

  return (
    <AbsoluteFill style={{ opacity: on }}>
      {/* seam */}
      <div style={{ position: "absolute", left: PANEL_R, top: 54, width: 1, height: WH - 108, backgroundColor: "#ffffff", opacity: 0.13 }} />
      {/* readouts */}
      <div style={{ position: "absolute", left: SIDE_X, top: 54, fontFamily: FONT_MONO, fontSize: 19, fontWeight: 500, color: "#9a9a9a", letterSpacing: 2, lineHeight: "30px" }}>
        <div style={{ color: "#d0d0d0", fontWeight: 700 }}>SPECTRUM · WATERFALL</div>
        <div>MULTI-RES FFT 1k–8k · HANN</div>
      </div>
      <div
        style={{
          position: "absolute",
          right: WW - SAFE_R,
          top: 54,
          textAlign: "right",
          fontFamily: FONT_MONO,
          fontSize: 19,
          fontWeight: 500,
          color: "#9a9a9a",
          letterSpacing: 2,
          lineHeight: "30px",
        }}
      >
        <div style={{ color: "#d0d0d0", fontWeight: 700 }}>{hold ? "■ HOLD" : "● RUN"}</div>
        <div>120 BPM</div>
      </div>

      <svg width={WW} height={WH} style={{ position: "absolute", left: 0, top: 0 }}>
        <defs>
          <pattern id="seg" width={14} height={6} patternUnits="userSpaceOnUse" y={M_BOT}>
            <rect width={14} height={4} fill="#d6d6d6" />
          </pattern>
        </defs>
        {/* meters: PK | RMS */}
        {live ? meterBar(SIDE_X, pk) : null}
        {live ? meterBar(SIDE_X + 22, rms) : null}
        {live && pkHold > DB_MIN ? <rect x={SIDE_X} y={yOfDb(pkHold) - 1} width={14} height={2} fill="#f2f2f2" /> : null}
        {scale.map((d) => (
          <g key={d}>
            <rect x={SIDE_X + 40} y={yOfDb(d) - 0.5} width={6} height={1} fill="#6a6a6a" />
            <text x={SIDE_X + 52} y={yOfDb(d) + 5} fill="#6f6f6f" fontFamily={FONT_MONO} fontSize={14} fontWeight={500}>
              {d === 0 ? "0" : d}
            </text>
          </g>
        ))}
        <text x={SIDE_X} y={M_BOT + 30} fill="#8d8d8d" fontFamily={FONT_MONO} fontSize={14} fontWeight={700} letterSpacing={1.5}>
          PK RMS
        </text>
        {/* loudness history */}
        {[-12, -24, -48].map((d) => (
          <rect key={d} x={G_X0} y={gy(d)} width={G_X1 - G_X0} height={1} fill="#ffffff" opacity={0.06} />
        ))}
        <rect x={G_X0} y={G_BOT} width={G_X1 - G_X0} height={1} fill="#5a5a5a" />
        {live ? (
          <>
            <path d={area} fill="#bdbdbd" opacity={0.16} />
            <path d={line} stroke="#d8d8d8" strokeWidth={1.6} fill="none" opacity={0.85} />
          </>
        ) : null}
        <text x={G_X0} y={G_TOP - 14} fill="#8d8d8d" fontFamily={FONT_MONO} fontSize={14} fontWeight={700} letterSpacing={1.5}>
          RMS 50 ms · 2.0 s
        </text>
        <text x={G_X1} y={G_TOP - 14} fill="#b8b8b8" fontFamily={FONT_MONO} fontSize={14} fontWeight={700} letterSpacing={1.5} textAnchor="end">
          {live ? `${rms.toFixed(1)} dBFS` : "—"}
        </text>
      </svg>

      {/* transport: holds the title's place until the title's kick */}
      {f < TITLE_T[0] ? (
        <div
          style={{
            position: "absolute",
            left: TITLE_X,
            top: TITLE_Y + 8,
            fontFamily: FONT_MONO,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: 3,
            lineHeight: "50px",
            color: "#5e5e5e",
            whiteSpace: "pre",
          }}
        >
          <div>{`POS  ${pos(f)}`}</div>
          <div>{`TC   ${tc(f)}`}</div>
        </div>
      ) : null}

      {/* title */}
      {f >= TITLE_T[0] ? (
        <>
          <div
            style={{
              position: "absolute",
              left: TITLE_X,
              top: TITLE_Y,
              width: SAFE_R - TITLE_X,
              fontFamily: FONT_DISPLAY,
              fontSize: TITLE_PX,
              letterSpacing: 4,
              color: C.paper,
              whiteSpace: "nowrap",
              clipPath: stepClip(w1),
            }}
          >
            WATERHOUSE
          </div>
          <div
            style={{
              position: "absolute",
              left: TITLE_X,
              top: TITLE_Y + TITLE_PX * 1.3,
              width: SAFE_R - TITLE_X,
              fontFamily: FONT_DISPLAY,
              fontSize: TITLE_PX,
              letterSpacing: 4,
              color: "#8f8f8f",
              whiteSpace: "nowrap",
              clipPath: stepClip(w2),
            }}
          >
            SESSIONS
          </div>
          <div style={{ position: "absolute", top: TITLE_Y + TITLE_PX * 2.75, left: TITLE_X, width: ruleW, height: 5, backgroundColor: C.yellow }} />
          <div
            style={{
              position: "absolute",
              top: TITLE_Y + TITLE_PX * 2.75 + 26,
              left: TITLE_X,
              fontFamily: FONT_MONO,
              fontWeight: 700,
              fontSize: 20,
              letterSpacing: 6,
              color: "#bdbdbd",
              whiteSpace: "pre",
            }}
          >
            {SUBTXT.slice(0, subChars).padEnd(SUBTXT.length, " ")}
          </div>
        </>
      ) : null}
    </AbsoluteFill>
  );
};

export const Spectro: React.FC = () => <SpectroView L={PORTRAIT} />;

/** 16:9 cut, registered as "Spectro-16x9" (1920×1080): same timeline, tape and audio. */
export const SpectroWide: React.FC = () => <SpectroView L={WIDE} />;
