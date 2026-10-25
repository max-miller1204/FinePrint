import { Img, interpolate, Sequence, staticFile, useCurrentFrame } from "remotion";
import { Eyebrow, Rise, Scene, TestTag, useRamp, useSpring } from "../components";
import { colors, fonts } from "../theme";

// A mock of the real Evidence flow. Strings are copied from the iOS app
// (EvidenceView, DeadlineCards, PhotoQuality, SealStatusPill, CameraScreen).

const PHONE_W = 430;
const PHONE_H = 932;

const P = { empty: 0, camera: 150, review: 430, list: 720 };
const HASH = "5e2873adc486a46a3a0d43a6933aa3977eead12c1fd0678da470d9ebca2c693a";

const TabBar: React.FC<{ active: string }> = ({ active }) => (
  <div
    style={{
      position: "absolute",
      left: 16,
      right: 16,
      bottom: 22,
      height: 70,
      borderRadius: 35,
      background: "rgba(40,44,56,0.82)",
      border: "1px solid rgba(255,255,255,0.12)",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-around",
      fontSize: 14,
      fontWeight: 600,
    }}
  >
    {["Lease", "Evidence", "Repairs", "Letters", "Ask"].map((t) => (
      <div key={t} style={{ color: t === active ? colors.blue : colors.muted }}>
        {t}
      </div>
    ))}
  </div>
);

const Accessory: React.FC<{ text: string }> = ({ text }) => (
  <div
    style={{
      position: "absolute",
      left: 28,
      right: 28,
      bottom: 104,
      height: 50,
      borderRadius: 25,
      background: "rgba(40,44,56,0.82)",
      border: "1px solid rgba(255,255,255,0.12)",
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "0 18px",
      fontSize: 16,
      fontWeight: 600,
    }}
  >
    <span style={{ width: 10, height: 10, borderRadius: 5, background: colors.orange }} />
    {text}
  </div>
);

const EmptyState: React.FC = () => (
  <div style={{ padding: "70px 24px 0" }}>
    <div style={{ fontSize: 38, fontWeight: 700 }}>Evidence</div>
    <div
      style={{
        marginTop: 150,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 14,
      }}
    >
      <div style={{ fontSize: 60, color: colors.muted }}>⌖</div>
      <div style={{ fontSize: 24, fontWeight: 700 }}>No move-in photos yet</div>
      <div style={{ fontSize: 17, color: colors.muted, lineHeight: 1.4 }}>
        In Virginia, you have 5 days after you get your landlord's move-in report to object to it
        in writing, so take your photos early.
      </div>
      <div
        style={{
          marginTop: 18,
          background: colors.blue,
          borderRadius: 26,
          padding: "14px 26px",
          fontSize: 18,
          fontWeight: 600,
          transform: `scale(${interpolate(useCurrentFrame(), [118, 126, 134], [1, 0.94, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          })})`,
        }}
      >
        Start move-in walkthrough
      </div>
    </div>
  </div>
);

const Camera: React.FC = () => {
  const frame = useCurrentFrame();
  const light = interpolate(frame, [150, 175], [0.28, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const warn = useSpring(70, 16) * (1 - useRamp(150, 160));
  const flash = (f: number) =>
    interpolate(frame, [f, f + 3, f + 12], [0, 0.9, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  return (
    <div style={{ position: "absolute", inset: 0, background: "#000" }}>
      <Img
        src={staticFile("kitchen-wall.jpg")}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          objectPosition: "33% 50%",
          filter: `brightness(${light})`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 70,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            background: "rgba(20,22,30,0.7)",
            borderRadius: 20,
            padding: "10px 20px",
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          Kitchen · Wall <span style={{ color: colors.muted }}>1 of 3</span>
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 24,
          right: 24,
          top: 130,
          opacity: warn,
          transform: `translateY(${(1 - warn) * -12}px)`,
          background: "rgba(255,159,10,0.92)",
          color: "#1A1205",
          borderRadius: 16,
          padding: "14px 18px",
          fontSize: 17,
          fontWeight: 600,
        }}
      >
        Too dark. Turn on a light or use flash.
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 60,
          left: "50%",
          marginLeft: -40,
          width: 80,
          height: 80,
          borderRadius: 40,
          border: "5px solid white",
          boxSizing: "border-box",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{ width: 60, height: 60, borderRadius: 30, background: "white" }} />
      </div>
      <div style={{ position: "absolute", inset: 0, background: "white", opacity: flash(50) + flash(230) }} />
    </div>
  );
};

const Review: React.FC = () => {
  const frame = useCurrentFrame();
  const sealed = useSpring(170, 14);
  const hashChars = Math.floor(
    interpolate(frame, [30, 80], [0, 24], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
  );
  return (
    <div style={{ padding: "64px 22px 0" }}>
      <Img
        src={staticFile("kitchen-wall.jpg")}
        style={{ width: "100%", height: 300, objectFit: "cover", borderRadius: 20 }}
      />
      <div style={{ marginTop: 18, fontSize: 22, fontWeight: 700 }}>Kitchen · Wall</div>
      <div style={{ marginTop: 6, fontSize: 16, color: colors.muted }}>Photo saved on this device.</div>
      <div style={{ marginTop: 22, fontSize: 14, color: colors.muted, fontWeight: 600 }}>
        SHA-256 fingerprint
      </div>
      <div style={{ marginTop: 6, fontFamily: fonts.mono, fontSize: 17, color: colors.green }}>
        {HASH.slice(0, hashChars)}
        {hashChars >= 24 ? "…" : ""}
      </div>
      <div style={{ marginTop: 26, position: "relative", height: 44 }}>
        {[
          { label: "Uploaded, waiting to seal", color: colors.blue, o: 1 - sealed },
          { label: "✓  Sealed", color: colors.green, o: sealed },
        ].map((pill) => (
          <div
            key={pill.label}
            style={{
              position: "absolute",
              opacity: pill.o,
              transform: `scale(${0.9 + 0.1 * pill.o})`,
              background: `${pill.color}26`,
              color: pill.color,
              borderRadius: 22,
              padding: "10px 18px",
              fontSize: 17,
              fontWeight: 700,
            }}
          >
            {pill.label}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 14, fontSize: 15, color: colors.muted, opacity: sealed, lineHeight: 1.4 }}>
        This photo is in a signed report. Any change to it would show.
      </div>
    </div>
  );
};

const ROOMS = [
  { name: "Kitchen", done: 3 },
  { name: "Bathroom", done: 3 },
  { name: "Bedroom", done: 2 },
  { name: "Living room", done: 0 },
];

const RoomList: React.FC = () => (
  <div style={{ padding: "70px 22px 0" }}>
    <div style={{ fontSize: 38, fontWeight: 700 }}>Evidence</div>
    <div style={{ marginTop: 6, fontSize: 16, color: colors.muted }}>Move-in walkthrough</div>
    <div style={{ marginTop: 24, borderRadius: 20, background: colors.surfaceRaised, overflow: "hidden" }}>
      {ROOMS.map((r, i) => (
        <Rise key={r.name} delay={8 + i * 6} distance={10}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              padding: "18px 20px",
              borderTop: i ? `1px solid ${colors.border}` : undefined,
              fontSize: 19,
            }}
          >
            <span>{r.name}</span>
            <span style={{ color: r.done === 3 ? colors.green : colors.muted, fontWeight: 600 }}>
              {r.done === 3 ? "✓ Sealed" : `${r.done} of 3`}
            </span>
          </div>
        </Rise>
      ))}
    </div>
    <Rise delay={50}>
      <div style={{ marginTop: 22, borderRadius: 20, background: colors.surfaceRaised, padding: 20 }}>
        <div style={{ fontSize: 19, fontWeight: 700 }}>Landlord's Report</div>
        <div style={{ marginTop: 8, fontSize: 15, color: colors.muted, lineHeight: 1.4 }}>
          Virginia law says your landlord must give you a written report of existing damage within 5
          days after you move in.
        </div>
        <div style={{ marginTop: 10, fontFamily: fonts.mono, fontSize: 13, color: colors.faint }}>
          Va. Code § 55.1-1214
        </div>
      </div>
    </Rise>
  </div>
);

const CALLOUTS = [
  { at: P.empty, eyebrow: "Evidence tab", title: "A guided walkthrough, room by room" },
  { at: P.camera, eyebrow: "On-device check", title: "Too dark? It asks for a retake, with the reason" },
  { at: P.review, eyebrow: "At the shutter", title: "Hashed on the phone. GPS removed." },
  { at: P.list, eyebrow: "Deadlines", title: "Sealed by the server, and the 5-day clock is tracked" },
];

export const MoveIn: React.FC = () => {
  const frame = useCurrentFrame();
  const enter = useSpring(0, 18);
  const current = [...CALLOUTS].reverse().find((c) => frame >= c.at) ?? CALLOUTS[0];
  const screen = (from: number, to: number) =>
    interpolate(frame, [from, from + 12, to - 12, to], [0, 1, 1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
  const darkUI = frame < P.camera || frame >= P.review;

  return (
    <Scene>
      <TestTag>mock UI · replace with screen recording</TestTag>
      <div
        style={{
          position: "absolute",
          left: 260,
          top: (1080 - PHONE_H) / 2,
          width: PHONE_W,
          height: PHONE_H,
          borderRadius: 64,
          padding: 12,
          background: "#2A2E38",
          boxShadow: "0 50px 100px rgba(0,0,0,0.5)",
          transform: `translateY(${(1 - enter) * 80}px)`,
          opacity: enter,
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            borderRadius: 52,
            overflow: "hidden",
            background: "#000",
            color: colors.text,
          }}
        >
          <div style={{ position: "absolute", inset: 0, opacity: screen(-20, P.camera) }}>
            <EmptyState />
          </div>
          <Sequence from={P.camera} durationInFrames={P.review - P.camera} layout="none">
            <div style={{ position: "absolute", inset: 0, opacity: screen(P.camera, P.review) }}>
              <Camera />
            </div>
          </Sequence>
          <Sequence from={P.review} durationInFrames={P.list - P.review} layout="none">
            <div style={{ position: "absolute", inset: 0, opacity: screen(P.review, P.list) }}>
              <Review />
            </div>
          </Sequence>
          <Sequence from={P.list} layout="none">
            <div style={{ position: "absolute", inset: 0, opacity: screen(P.list, 99999) }}>
              <RoomList />
            </div>
          </Sequence>
          {darkUI && (
            <>
              <Accessory text={frame >= P.list ? "Landlord's report due in 5 days" : "Move-in: Nov 1"} />
              <TabBar active="Evidence" />
            </>
          )}
          <div
            style={{
              position: "absolute",
              top: 14,
              left: "50%",
              marginLeft: -62,
              width: 124,
              height: 36,
              borderRadius: 18,
              background: "#000",
            }}
          />
        </div>
      </div>

      <div style={{ position: "absolute", left: 860, right: 160, top: 380 }}>
        <Sequence key={current.at} from={current.at} layout="none">
          <Rise>
            <Eyebrow color={colors.green}>{current.eyebrow}</Eyebrow>
            <div style={{ marginTop: 20, fontSize: 64, fontWeight: 700, letterSpacing: -1.5, lineHeight: 1.12 }}>
              {current.title}
            </div>
          </Rise>
        </Sequence>
      </div>
    </Scene>
  );
};
