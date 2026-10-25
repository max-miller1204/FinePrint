// Deterministic model boundary for the HTTP/SSE batching proof. Never used by production.
import { serve } from '@hono/node-server';
import { createApp } from '../../src/app.js';
import { createGemma, estimateInputTokens } from '../../src/ai/gemma.js';
import { modelConfigFromEnv } from '../../src/ai/models.js';
import type { ProviderRequest } from '../../src/ai/provider.js';
import { SEGMENT_INSTRUCTION } from '../../src/ai/prompts/lease.js';
import { createTriage } from '../../src/ai/triage/index.js';
import { keywordBackstop } from '../../src/ai/triage/keywords.js';
import { memoryUsageSink } from '../../src/usage.js';
import { memoryStore } from '../memory-store.js';
import { memoryObjects } from '../memory-objects.js';

const requests: { model: string; ids: string[]; inputTokens: number; outputCap: number | undefined }[] = [];
const gemma = createGemma({
  config: modelConfigFromEnv({}),
  usage: memoryUsageSink(),
  provider: {
    name: 'scripted',
    async generate(request: ProviderRequest) {
      const docs = request.parts.flatMap((part) => {
        const m = 'text' in part && /^<document id="([^"]+)">\n([\s\S]*)\n<\/document>$/.exec(part.text);
        return m ? [{ id: m[1]!, text: m[2]! }] : [];
      });
      const last = request.parts.at(-1);
      const task = last && 'text' in last ? last.text : '';
      let answer: unknown;
      if (request.systemInstruction.includes(SEGMENT_INSTRUCTION)) {
        answer = {
          documentType: 'residential_lease', aiInstructions: false, keyTerms: [],
          clauses: [...docs[0]!.text.matchAll(/^\d+\. [^\n]+/gm)].map((m) => ({ heading: m[0].split('.')[1]!.trim(), start: m[0].split(' ').slice(0, 8).join(' ') })),
        };
      } else if (request.systemInstruction.includes('You check lease clauses against the exact words')) {
        answer = { checks: [...task.matchAll(/clause (\S+) against (\S+)/g)].map((m) => ({ clauseId: m[1], ruleId: m[2], assessment: 'violates', reasoning: 'The lease permits confession of judgment.' })) };
      } else if (request.systemInstruction.includes('You explain findings')) {
        const ids = /Explain findings (.+?), once each/.exec(task)![1]!.split(', ');
        answer = { explanations: ids.map((findingId) => ({ findingId, title: 'About this lease term', explanation: 'This term may not be fair. You can ask for help.' })) };
      } else {
        requests.push({ model: request.model, ids: docs.map((d) => d.id), inputTokens: estimateInputTokens(request.systemInstruction, request.parts), outputCap: request.maxOutputTokens });
        answer = { mappings: docs.filter((d) => d.text.startsWith('20. CONFESSION OF JUDGMENT.')).map((d) => ({ clauseId: d.id, ruleIds: ['VA_NO_CONFESSION_OF_JUDGMENT'], assessment: 'violates', leaseQuote: 'Tenant hereby authorizes any attorney chosen by Landlord to appear for Tenant in any court', reasoning: 'The lease permits confession of judgment.' })) };
      }
      return { text: JSON.stringify(answer), promptTokens: 100, outputTokens: 100, thoughtTokens: 0 };
    },
  },
});
const app = createApp({
  verifyIdToken: async () => ({ uid: 'batch-proof', provider: 'anonymous' }),
  store: memoryStore().store, objects: memoryObjects().store, signer: null,
  verifyScheduler: null, clientConfig: null, gemma,
  triage: createTriage({ model: null, keywords: keywordBackstop() }),
});
app.get('/batch-proof/requests', (c) => c.json(requests));
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' }, (info) => process.send?.({ port: info.port }));
process.once('SIGTERM', () => server.close(() => process.exit(0)));
