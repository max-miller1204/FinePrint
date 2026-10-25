import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { Card, Eyebrow, Rise, Scene, TestTag, useRamp, useSpring } from "../components";
import { colors, fonts } from "../theme";

// Lease text: server/test/fixtures/lease-synthetic.txt. Citations and statute
// quotes: jurisdictions/va/rules. Stages: docs/ai-pipeline.md, "Lease pipeline".

const CLAUSES = [
  { n: 3, head: "RENT", text: "Tenant shall pay monthly rent of $1,500.00, in advance, on or before the first (1st) day of each month…" },
  { n: 4, head: "LATE CHARGES", text: "…Tenant shall pay a late charge equal to fifteen percent (15%) of the monthly rent…", flag: 1 },
  { n: 5, head: "SECURITY DEPOSIT", text: "Before moving in, Tenant shall pay a security deposit of $4,500.00 (three months' rent)…", flag: 0 },
  { n: 9, head: "MOVE-IN INSPECTION", text: "Within five (5) days after Tenant moves in, Landlord will give Tenant a written report…" },
  { n: 11, head: "ENTRY BY LANDLORD", text: "Landlord may enter the Premises to perform routine maintenance upon twenty-four (24) hours' notice…", flag: 2 },
  { n: 19, head: "WAIVER OF RIGHTS", text: "Tenant waives all rights and remedies Tenant may have under the Virginia Residential Landlord and Tenant Act…", flag: 3 },
  { n: 21, head: "ATTORNEY FEES", text: "Tenant shall pay all of Landlord's attorney fees, court costs, and collection costs…", flag: 4 },
];

const FINDINGS = [
  { title: "Deposit is three months' rent", cite: "Va. Code § 55.1-1226(A)", by: "code" },
  { title: "Late fee is 15% of rent", cite: "Va. Code § 55.1-1204(E)", by: "code" },
  { title: "Only 24 hours' notice for routine maintenance", cite: "Va. Code § 55.1-1229(A)(4)", by: "code" },
  { title: "You give up your rights under the VRLTA", cite: "Va. Code § 55.1-1208(A)(1)", by: "gemma" },
  { title: "You pay the landlord's attorney fees", cite: "Va. Code § 55.1-1208(A)(4)", by: "gemma" },
];

const FINDING_START = 200;
const FINDING_GAP = 55;
const DETAIL = 560;

const STAGES = [
  { id: "S1", name: "Triage", by: "26B" },
  { id: "S2", name: "Clauses + key terms", by: "26B" },
  { id: "S3", name: "Quotes checked", by: "code" },
  { id: "S4", name: "Rule checks", by: "code" },
  { id: "S5", name: "Rule mapping", by: "26B" },
];

const TraceStrip: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <div
      style={{
        position: "absolute",
        left: 120,
        right: 120,
        bottom: 56,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      {STAGES.map((s, i) => {
        const start = 20 + i * 34;
        const on = interpolate(frame, [start, start + 10], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const isModel = s.by === "26B";
        const accent = isModel ? colors.orange : colors.blue;
        return (
          <div
            key={s.id}
            style={{
              flex: 1,
              padding: "14px 18px",
              borderRadius: 16,
              background: colors.surface,
              border: `1px solid ${on > 0.5 ? `${accent}88` : colors.border}`,
              opacity: 0.35 + 0.65 * on,
            }}
          >
            <div style={{ fontFamily: fonts.mono, fontSize: 16, color: accent }}>
              {s.id} · {isModel ? "gemma-4-26b-a4b-it" : "deterministic code"}
            </div>
            <div style={{ fontSize: 22, fontWeight: 600, marginTop: 4 }}>{s.name}</div>
          </div>
        );
      })}
    </div>
  );
};

const LeaseCard: React.FC = () => {
  const frame = useCurrentFrame();
  const scan = interpolate(frame, [30, 190], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <Rise delay={4} style={{ position: "absolute", left: 120, top: 150, width: 760 }}>
      <Card style={{ height: 690, padding: 32, position: "relative", overflow: "hidden" }}>
        <div style={{ fontFamily: fonts.mono, fontSize: 18, color: colors.muted, letterSpacing: 1 }}>
          RESIDENTIAL LEASE AGREEMENT · Commonwealth of Virginia
        </div>
        {CLAUSES.map((c) => {
          const flagged =
            c.flag !== undefined
              ? interpolate(frame, [FINDING_START + c.flag * FINDING_GAP, FINDING_START + c.flag * FINDING_GAP + 12], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
              : 0;
          return (
            <div
              key={c.n}
              style={{
                marginTop: 18,
                padding: "8px 14px",
                borderLeft: `4px solid rgba(255,69,58,${flagged})`,
                background: `rgba(255,69,58,${0.1 * flagged})`,
                borderRadius: 6,
                fontSize: 19,
                lineHeight: 1.4,
                color: colors.muted,
              }}
            >
              <span style={{ color: colors.text, fontWeight: 600 }}>
                {c.n}. {c.head}.
              </span>{" "}
              {c.text}
            </div>
          );
        })}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            top: 60 + scan * 600,
            height: 70,
            background: `linear-gradient(transparent, ${colors.orange}22, transparent)`,
            opacity: scan > 0 && scan < 1 ? 1 : 0,
          }}
        />
      </Card>
    </Rise>
  );
};

const Finding: React.FC<{ f: (typeof FINDINGS)[number]; i: number }> = ({ f, i }) => {
  const p = useSpring(FINDING_START + i * FINDING_GAP);
  return (
    <div
      style={{
        opacity: p,
        transform: `translateX(${(1 - p) * 40}px)`,
        marginBottom: 16,
        background: colors.surface,
        border: `1px solid ${colors.border}`,
        borderRadius: 18,
        padding: "18px 22px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ color: colors.red, fontWeight: 700, fontSize: 18 }}>⬣ Likely unenforceable</span>
        <span
          style={{
            fontFamily: fonts.mono,
            fontSize: 15,
            padding: "4px 12px",
            borderRadius: 999,
            color: f.by === "code" ? colors.blue : colors.orange,
            background: f.by === "code" ? `${colors.blue}22` : `${colors.orange}22`,
          }}
        >
          {f.by === "code" ? "checked by code" : "mapped by Gemma 4"}
        </span>
      </div>
      <div style={{ fontSize: 26, fontWeight: 600, marginTop: 8 }}>{f.title}</div>
      <div style={{ fontFamily: fonts.mono, fontSize: 16, color: colors.muted, marginTop: 4 }}>{f.cite}</div>
    </div>
  );
};

const Mark: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span style={{ background: `${color}33`, color, borderRadius: 6, padding: "0 4px" }}>{children}</span>
);

const Detail: React.FC = () => {
  const p = useSpring(DETAIL + 10);
  return (
    <AbsoluteFill style={{ padding: "150px 120px 0", opacity: p }}>
      <Rise delay={DETAIL + 10}>
        <Eyebrow color={colors.red}>Finding · Late charges · clause 4</Eyebrow>
        <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -1, marginTop: 14 }}>
          Virginia caps late fees at 10% of rent.
        </div>
      </Rise>
      <div style={{ display: "flex", gap: 40, marginTop: 44 }}>
        <Rise delay={DETAIL + 30} style={{ flex: 1 }}>
          <Card>
            <Eyebrow>Your lease · verbatim</Eyebrow>
            <div style={{ fontSize: 30, lineHeight: 1.45, marginTop: 16 }}>
              “…Tenant shall pay a late charge equal to <Mark color={colors.red}>fifteen percent (15%)</Mark> of the monthly
              rent.”
            </div>
          </Card>
        </Rise>
        <Rise delay={DETAIL + 50} style={{ flex: 1 }}>
          <Card>
            <Eyebrow>Va. Code § 55.1-1204(E) · verbatim</Eyebrow>
            <div style={{ fontSize: 30, lineHeight: 1.45, marginTop: 16 }}>
              “No such late charge shall exceed the lesser of <Mark color={colors.green}>10 percent of the periodic rent</Mark> or
              10 percent of the remaining balance…”
            </div>
          </Card>
        </Rise>
      </div>
      <Rise delay={DETAIL + 90}>
        <div style={{ marginTop: 36, fontFamily: fonts.mono, fontSize: 26, color: colors.muted }}>
          lateFeeCap(lateFee: <span style={{ color: colors.red }}>$225.00</span>, monthlyRent: $1,500.00) → cap{" "}
          <span style={{ color: colors.green }}>$150.00</span>
        </div>
      </Rise>
      <Rise delay={DETAIL + 120}>
        <div style={{ marginTop: 24, fontSize: 32, color: colors.text }}>
          What you can do: ask your landlord to change this to 10% or less before you sign.
        </div>
      </Rise>
    </AbsoluteFill>
  );
};

export const Gemma: React.FC = () => {
  const frame = useCurrentFrame();
  const away = useRamp(DETAIL - 10, DETAIL + 14);
  return (
    <Scene>
      <TestTag>real lease fixture + rule pack · findings staged</TestTag>
      <div style={{ position: "absolute", left: 120, top: 70 }}>
        <Rise>
          <Eyebrow color={colors.orange}>Gemma 4 reads the lease · code checks every quote</Eyebrow>
        </Rise>
      </div>
      <AbsoluteFill style={{ opacity: 1 - away, filter: `blur(${away * 8}px)` }}>
        <LeaseCard />
        <div style={{ position: "absolute", left: 940, right: 120, top: 150 }}>
          {FINDINGS.map((f, i) => (
            <Finding key={f.title} f={f} i={i} />
          ))}
        </div>
      </AbsoluteFill>
      {frame >= DETAIL - 10 && <Detail />}
      <TraceStrip />
    </Scene>
  );
};
