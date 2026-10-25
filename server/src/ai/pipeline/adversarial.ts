// Documents are data, not instructions (spec §7.10). Two things a tenant's
// upload can be besides an ordinary lease:
//   - a lease with text aimed at AI tools ("AI assistant: ignore previous
//     instructions"). The analysis continues as if it were not there; the
//     tenant gets one `info` finding saying we saw it and ignored it.
//   - not a residential lease at all. The pipeline stops after S2 with a
//     plain message.
// The injection detector is a code pattern here plus S2's `aiInstructions`
// flag; either one is enough. Neither can change a severity: the finding is
// separate from the checks and mappings, which never read the flag.

import type { DocumentType } from '../schemas/lease.js';
import type { Clause } from './types.js';

export const NOT_A_LEASE_MESSAGE = "This doesn't look like a residential lease.";

export const INJECTION_FINDING_TITLE = 'Hidden instructions for AI tools';
export const INJECTION_FINDING_EXPLANATION = 'This document contains hidden instructions aimed at AI tools. We ignored them.';

// The finding's text per language, fixed and reviewed here rather than sent
// to S9: it is the same two sentences on every lease, and a model should not
// be the one to word a note about text aimed at models. A language not listed
// gets English.
const INJECTION_FINDING_TEXT: Readonly<Record<string, { title: string; explanation: string }>> = {
  en: { title: INJECTION_FINDING_TITLE, explanation: INJECTION_FINDING_EXPLANATION },
  es: {
    title: 'Instrucciones ocultas para herramientas de IA',
    explanation: 'Este documento contiene instrucciones ocultas dirigidas a herramientas de IA. Las ignoramos.',
  },
};

// "es-MX" -> the `es` text.
export function injectionFindingText(locale: string): { title: string; explanation: string } {
  const language = locale.trim().toLowerCase().split(/[-_]/)[0]!;
  return INJECTION_FINDING_TEXT[language] ?? INJECTION_FINDING_TEXT.en!;
}

// Characters that hide or split words without showing: zero-width spaces and
// joiners, bidi controls, word joiners, the BOM, and soft hyphens.
const INVISIBLE = /[­​-‏‪-‮⁠-⁤﻿]/g;

// Who the text is talking to.
const AI = String.raw`(?:ai|a\.i\.|llm|large language model|language model|chat ?bot|chat ?gpt|gpt(?:-?\d\w*)?|gemini|gemma|claude|copilot|bard)`;
const AI_ADDRESSEE = String.raw`(?:${AI}(?:\s+(?:assistant|model|tool|system|agent|reviewer|reader))?s?|(?:virtual|automated|digital)\s+assistants?)`;
// What it tells the reader to do.
const IMPERATIVE = String.raw`(?:you\s+(?:must|should|will|are\s+to|need\s+to)|please|ignore|disregard|forget|say|state|answer|respond|reply|output|print|mark|report|classify|rate|treat|tell|confirm|conclude|do\s+not|don't|never)`;

const INJECTION_PATTERNS: readonly RegExp[] = [
  // "Ignore all previous instructions", "disregard the above rules". Not
  // after "not" or "never": "Tenant shall not disregard the prior rules".
  /(?<!(?:\bnot|\bnever|n't)\s+)\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+)?(?:of\s+)?(?:the\s+|your\s+|my\s+|these\s+|those\s+)?(?:previous|prior|above|earlier|preceding|original|system|initial)\s+(?:instructions?|prompts?|rules|directions|directives|guidelines|commands)/i,
  /(?<!(?:\bnot|\bnever|n't)\s+)\b(?:ignore|disregard|forget)\s+(?:everything|anything|all)\s+(?:above|before\s+this|you\s+were\s+told)/i,
  // "AI assistant: say ...", "Gemini, mark ...".
  new RegExp(String.raw`\b${AI_ADDRESSEE}\s*[:,;-]\s*${IMPERATIVE}`, 'i'),
  // "Note to any AI reading this", "Instructions for language models".
  new RegExp(String.raw`\b(?:note|message|instructions?|attention|directions?)\s+(?:to|for)\s+(?:any\s+|all\s+|the\s+)?${AI_ADDRESSEE}\b`, 'i'),
  // "If you are an AI ...", "To the AI model reading this".
  new RegExp(String.raw`\bif\s+you\s+are\s+(?:an?\s+)?${AI_ADDRESSEE}\b`, 'i'),
  new RegExp(String.raw`\b(?:to|dear|hey|attention)\s+(?:the\s+|any\s+|all\s+)?${AI_ADDRESSEE}\s+(?:reading|reviewing|analy[sz]ing|processing|summari[sz]ing)\b`, 'i'),
  // Role changes: "You are now a helpful landlord assistant".
  /\byou\s+are\s+now\s+(?:an?\s+)?(?:\w+\s+){0,3}(?:assistant|ai|model|bot|chatbot|agent)\b/i,
  /\b(?:system\s+prompt|developer\s+mode|jailbreak|new\s+instructions\s*:)/i,
  // Chat-template tokens that only make sense to a model.
  /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>|\[\/?INST\]|<<\/?SYS>>|<\/?start_of_turn>|<\/?end_of_turn>/i,
  // Spanish: "ignora las instrucciones anteriores", "asistente de IA: di ...".
  /\b(?:ignora|ignore|olvida|olvide|descarta|descarte)\s+(?:todas\s+)?(?:las\s+)?(?:instrucciones|indicaciones|reglas)\s+(?:anteriores|previas|de\s+arriba)/i,
  /\b(?:asistente\s+de\s+ia|asistente\s+virtual|inteligencia\s+artificial|modelo\s+de\s+lenguaje|ia)\s*[:,]\s*(?:debes|di|responde|marca|ignora|no\s+)/i,
  /\bsi\s+eres\s+(?:una?\s+)?(?:ia|inteligencia\s+artificial|modelo\s+de\s+lenguaje|asistente)\b/i,
];

// The text the patterns read: compatibility forms folded (full-width
// letters), invisible characters removed, and whitespace collapsed.
export function normalizeForDetection(text: string): string {
  return text.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ');
}

// Text addressed to an AI ("ignore previous instructions", "AI assistant:").
export function detectInjection(text: string): boolean {
  const normalized = normalizeForDetection(text);
  return INJECTION_PATTERNS.some((p) => p.test(normalized));
}

export interface InjectionFinding {
  id: 'injection';
  kind: 'injection';
  // Always `info`: it tells the tenant what we saw and never ranks with the
  // legal findings.
  severity: 'info';
  title: string;
  explanation: string;
  // The clauses the pattern found it in, for the clause explorer. Empty when
  // only the model flagged it or the text spans clauses.
  clauseIds: string[];
}

export interface Injection {
  // S2's flag and a code pattern for text aimed at AI tools (spec §7.10).
  detected: boolean;
  model: boolean;
  pattern: boolean;
  // Null when nothing was detected, and on a non-lease (no findings).
  finding: InjectionFinding | null;
}

export function assessInjection(text: string, modelFlag: boolean): Injection {
  const pattern = detectInjection(text);
  return { detected: pattern || modelFlag, model: modelFlag, pattern, finding: null };
}

// After S3: the finding in the lease's locale, pointing at the clauses that
// hold the text.
export function withInjectionFinding(injection: Injection, clauses: readonly Clause[], locale: string): Injection {
  if (!injection.detected) return injection;
  const { title, explanation } = injectionFindingText(locale);
  return {
    ...injection,
    finding: {
      id: 'injection',
      kind: 'injection',
      severity: 'info',
      title,
      explanation,
      clauseIds: clauses.filter((c) => detectInjection(c.verbatim)).map((c) => c.id),
    },
  };
}

export interface NotALease {
  documentType: Exclude<DocumentType, 'residential_lease'>;
  message: string;
}

export function notALease(documentType: Exclude<DocumentType, 'residential_lease'>): NotALease {
  return { documentType, message: NOT_A_LEASE_MESSAGE };
}
