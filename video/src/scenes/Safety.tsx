import { Eyebrow, Rise, Scene } from "../components";
import { colors, fonts } from "../theme";

// Numbers: docs/ai-pipeline.md, escalation eval of 2026-10-24 (129 cases: 65 high-stakes, 64 look-alikes).
// Measured output only, so no mock UI here.
const SIGNALS = ["Lockouts", "Eviction and court", "Utility shutoffs", "Discrimination", "Violence or danger"];

export const Safety: React.FC = () => (
  <Scene>
    <div style={{ position: "absolute", left: 160, right: 160, top: 150 }}>
      <Rise>
        <Eyebrow color={colors.red}>High stakes go to people, not the AI</Eyebrow>
      </Rise>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 60, marginTop: 30 }}>
        <Rise delay={8}>
          <div style={{ fontSize: 230, fontWeight: 700, letterSpacing: -8, lineHeight: 1, color: colors.green }}>100%</div>
        </Rise>
        <Rise delay={16} style={{ paddingBottom: 26 }}>
          <div style={{ fontSize: 48, fontWeight: 600, lineHeight: 1.2 }}>
            of 65 high-stakes eval cases
            <br />
            flagged for a person
          </div>
          <div style={{ fontSize: 30, color: colors.muted, marginTop: 14 }}>
            Gemma 4 triage plus a keyword backstop · English and Spanish
          </div>
        </Rise>
      </div>
      <div style={{ display: "flex", gap: 16, marginTop: 50 }}>
        {SIGNALS.map((s, i) => (
          <Rise key={s} delay={30 + i * 6} distance={10}>
            <div
              style={{
                fontSize: 28,
                fontWeight: 600,
                padding: "14px 24px",
                borderRadius: 999,
                background: `${colors.red}1F`,
                color: "#FFB3AE",
              }}
            >
              {s}
            </div>
          </Rise>
        ))}
      </div>
      <Rise delay={50}>
        <div style={{ marginTop: 40, fontFamily: fonts.mono, fontSize: 20, color: colors.faint }}>
          eval/datasets/escalation.jsonl · 129 cases · recall 100% · precision 98.5% on 64 look-alikes · gemma-4-26b-a4b-it
        </div>
      </Rise>
    </div>
  </Scene>
);
