// Voiceover script, cut into caption cues. Frames are relative to each scene (30 fps).
// voiceover-script.md is generated from this file: `npm run vo-script`.
// Lines start at `from` or right after the previous line, whichever is later (src/timeline.ts).

export type Cue = { from: number; to: number; text: string };

export const CAPTIONS: Record<string, Cue[]> = {
  Hook: [
    {
      from: 6,
      to: 300,
      text: "When Jordan, a Virginia Tech junior, moves in, the landlord's damage report counts as correct unless Jordan objects in writing within five days.",
    },
  ],
  Stakes: [
    { from: 8, to: 200, text: "Most Blacksburg households rent, and nearly a quarter of renters who move get no deposit back." },
  ],
  Title: [],
  MoveIn: [
    { from: 8, to: 150, text: "FinePrint tracks that five-day clock, and walks you through each room." },
    { from: 175, to: 300, text: "It checks every photo on the phone. Too dark? It tells you." },
    { from: 310, to: 480, text: "Each photo gets a SHA-256 fingerprint, with its location data stripped." },
    { from: 490, to: 640, text: "Sealing signs the report with Cloud KMS, in a hash-chained ledger." },
  ],
  Lease: [
    {
      from: 8,
      to: 220,
      text: "Next, the lease. Names and addresses are hidden on the phone, and you can see exactly what gets sent.",
    },
    { from: 222, to: 432, text: "Then Gemma 4 reads it. The 26B model triages and maps every clause to Virginia law." },
    { from: 440, to: 611, text: "The 31B model double-checks, and code verifies every quote and does the math." },
    { from: 625, to: 778, text: "Twelve findings, each quoting the lease word for word, with the law beside it." },
    { from: 785, to: 917, text: "A fifteen percent late fee, against Virginia's ten percent cap." },
  ],
  Ask: [
    { from: 8, to: 220, text: "Ask looks things up with Gemma 4 function calling, and drops any sentence without a citation." },
    { from: 300, to: 405, text: "Out of scope? It points you to Virginia Legal Aid." },
  ],
  Safety: [{ from: 8, to: 150, text: "High-stakes cases go to people. Our triage eval caught all 65." }],
  Delete: [{ from: 8, to: 150, text: "And Delete Everything wipes the phone and the server, with a receipt." }],
  Close: [
    { from: 8, to: 130, text: "Legal aid groups can deploy their own copy with one script." },
    { from: 140, to: 380, text: "26B does most of the work, and 31B only verifies: about 29,000 prompt tokens per lease." },
    { from: 400, to: 530, text: "FinePrint is open source, under Apache-2.0." },
  ],
};
