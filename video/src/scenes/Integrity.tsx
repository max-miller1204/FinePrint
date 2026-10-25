import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { Card, Eyebrow, Rise, Scene, Seal, useRamp, useSpring } from "../components";
import { colors, fonts } from "../theme";

// Real SHA-256 of public/kitchen-wall.jpg (e2e fixture move-in/01-kitchen-wall.jpg).
const HASH = "5e2873adc486a46a3a0d43a6933aa3977eead12c1fd0678da470d9ebca2c693a";

const T = { photo: 0, hash: 70, manifest: 170, sign: 270, ledger: 370, verify: 500 };

const STATION_W = 367;
const STATION_TOP = 170;
const STATION_H = 400;

const Connector: React.FC<{ x: number; start: number }> = ({ x, start }) => {
  const p = useRamp(start, start + 16);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: STATION_TOP + STATION_H / 2,
        width: 70 * p,
        height: 2,
        background: colors.faint,
      }}
    />
  );
};

const Station: React.FC<{
  index: number;
  start: number;
  step: string;
  title: string;
  children: React.ReactNode;
}> = ({ index, start, step, title, children }) => (
  <div
    style={{
      position: "absolute",
      left: 120 + index * (STATION_W + 70),
      top: STATION_TOP,
      width: STATION_W,
    }}
  >
    <Rise delay={start}>
      <Eyebrow>{step}</Eyebrow>
      <div style={{ fontSize: 34, fontWeight: 600, margin: "10px 0 20px" }}>{title}</div>
      <Card style={{ height: STATION_H - 110, padding: 24, overflow: "hidden" }}>
        {children}
      </Card>
    </Rise>
  </div>
);

const Pill: React.FC<{ color: string; children: React.ReactNode; delay: number }> = ({
  color,
  children,
  delay,
}) => {
  const p = useSpring(delay, 14);
  return (
    <span
      style={{
        display: "inline-block",
        transform: `scale(${p})`,
        padding: "6px 14px",
        borderRadius: 999,
        fontSize: 18,
        fontWeight: 600,
        background: `${color}22`,
        color,
        marginRight: 8,
      }}
    >
      {children}
    </span>
  );
};

const LEDGER = [
  { seq: 1, type: "manifest_sealed", color: colors.green },
  { seq: 2, type: "evidence_deleted", color: colors.orange },
  { seq: 3, type: "manifest_sealed", color: colors.green },
];

export const Integrity: React.FC = () => {
  const frame = useCurrentFrame();
  const hashChars = Math.floor(
    interpolate(frame, [T.hash + 12, T.hash + 60], [0, HASH.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const stamp = useSpring(T.sign + 30, 10);

  return (
    <Scene>
      <div style={{ position: "absolute", left: 120, top: 70 }}>
        <Rise>
          <Eyebrow color={colors.green}>Evidence integrity</Eyebrow>
        </Rise>
      </div>

      <Station index={0} start={T.photo} step="01 · On the phone" title="Captured in-app">
        <Img
          src={staticFile("kitchen-wall.jpg")}
          style={{ width: "100%", height: 180, objectFit: "cover", borderRadius: 14 }}
        />
        <div style={{ marginTop: 16 }}>
          <Pill color={colors.blue} delay={T.photo + 20}>
            Kitchen · Wall
          </Pill>
          <Pill color={colors.red} delay={T.photo + 34}>
            GPS removed
          </Pill>
        </div>
      </Station>
      <Connector x={120 + STATION_W} start={T.hash - 10} />

      <Station index={1} start={T.hash} step="02 · At the shutter" title="SHA-256">
        <div
          style={{
            fontFamily: fonts.mono,
            fontSize: 30,
            lineHeight: 1.55,
            color: colors.green,
          }}
        >
          {[0, 16, 32, 48].map((start) => (
            <div key={start}>{HASH.slice(start, Math.min(start + 16, hashChars))}&nbsp;</div>
          ))}
        </div>
      </Station>
      <Connector x={120 + STATION_W * 2 + 70} start={T.manifest - 10} />

      <Station index={2} start={T.manifest} step="03 · On the server" title="Manifest">
        <div style={{ fontFamily: fonts.mono, fontSize: 19, lineHeight: 1.65, color: colors.muted }}>
          {[
            ["room", '"kitchen"'],
            ["checklistItem", '"wall"'],
            ["sha256", '"5e2873ad…c693a"'],
            ["capturedAtDevice", "…"],
            ["receivedAtServer", "…"],
            ["prevLedgerHead", "{ … }"],
          ].map(([k, v], i) => (
            <Rise key={k} delay={T.manifest + 10 + i * 5} distance={10}>
              <span style={{ color: colors.blue }}>{k}</span>: <span style={{ color: colors.text }}>{v}</span>
            </Rise>
          ))}
        </div>
        <Rise delay={T.manifest + 50}>
          <div style={{ marginTop: 14, fontSize: 18, color: colors.faint }}>
            RFC 8785 canonical JSON
          </div>
        </Rise>
      </Station>
      <Connector x={120 + STATION_W * 3 + 140} start={T.sign - 10} />

      <Station index={3} start={T.sign} step="04 · Cloud KMS" title="Signed">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            gap: 18,
          }}
        >
          <div style={{ transform: `scale(${stamp}) rotate(${(1 - stamp) * 30}deg)` }}>
            <Seal size={110} />
          </div>
          <div style={{ fontFamily: fonts.mono, fontSize: 20, color: colors.muted }}>
            EC P-256 · SHA-256
          </div>
        </div>
      </Station>

      <div style={{ position: "absolute", left: 120, top: 640 }}>
        <Rise delay={T.ledger}>
          <Eyebrow>Hash-chained ledger · deletions are logged, not hidden</Eyebrow>
        </Rise>
      </div>
      <div style={{ position: "absolute", left: 120, top: 700, display: "flex", alignItems: "center" }}>
        {LEDGER.map((e, i) => (
          <div key={e.seq} style={{ display: "flex", alignItems: "center" }}>
            {i > 0 && (
              <Rise delay={T.ledger + 10 + i * 22} distance={0}>
                <div
                  style={{
                    fontFamily: fonts.mono,
                    fontSize: 18,
                    color: colors.faint,
                    width: 190,
                    textAlign: "center",
                  }}
                >
                  ← prevEntryHash
                </div>
              </Rise>
            )}
            <Rise delay={T.ledger + 10 + i * 22}>
              <Card style={{ padding: "20px 26px", borderLeft: `4px solid ${e.color}` }}>
                <div style={{ fontFamily: fonts.mono, fontSize: 18, color: colors.faint }}>
                  seq {e.seq}
                </div>
                <div style={{ fontFamily: fonts.mono, fontSize: 26, marginTop: 6 }}>{e.type}</div>
              </Card>
            </Rise>
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", left: 120, right: 120, top: 836 }}>
        <Rise delay={T.verify}>
          <div style={{ fontSize: 40, fontWeight: 600 }}>
            Anyone can check the signatures against our published keys.
          </div>
          <div style={{ marginTop: 12, fontFamily: fonts.mono, fontSize: 26, color: colors.blue }}>
            GET /.well-known/fineprint-keys.json
          </div>
        </Rise>
      </div>
    </Scene>
  );
};
