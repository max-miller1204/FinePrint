// Test-only provider transport. Production never imports this file.
import { createServer } from 'node:http';
const provider = createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const prompt = JSON.stringify(body.messages);
  let content: string | null = null;
  let tool_calls: unknown[] | undefined;
  if (!prompt.includes('Final responses must match')) {
    content = JSON.stringify({ category: 'none', confidence: 1 });
  } else {
    const dataText = body.messages[1].content[0].text as string;
    const match = /<document id="conversation">\n([\s\S]*)\n<\/document>/.exec(dataText);
    const data = JSON.parse(match![1]!);
    if (data.message.includes('football')) content = JSON.stringify({ type: 'answer', answer: { outOfScope: true, sentences: [] } });
    else if (!data.transcript.length) {
      tool_calls = [{ id: 'call_1', type: 'function', function: { name: 'get_deadlines', arguments: '{}' } }];
    } else {
      const source = data.transcript[0].result[0];
      content = JSON.stringify({ type: 'answer', answer: { outOfScope: false, sentences: [
        { text: 'The move-in report is due on November 6, 2026.', citations: source ? [{ kind: source.kind, ref: source.ref }] : [] },
        { text: 'This uncited claim must never appear.', citations: [] },
        { text: 'This invented citation must never appear.', citations: [{ kind: 'rule', ref: 'invented' }] },
      ] } });
    }
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ choices: [{ message: { content, ...(tool_calls ? { tool_calls } : {}) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }));
});
await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
const address = provider.address() as { port: number };
process.env.GEMMA_PROVIDER = 'openai_compatible';
process.env.GEMMA_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
await import('../server/src/index.js');
