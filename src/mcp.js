// MCP server (stdio) that lets an agent buy AgentFeed data in USDC on NEAR testnet. Tools: list_routes, call_route.
//   AGENT_ACCOUNT_ID=you.testnet [AGENT_PRIVATE_KEY=ed25519:...] GATEWAY_URL=https://near.ochinimus.app node src/mcp.js
// Without AGENT_PRIVATE_KEY the key is read from ~/.near-credentials/testnet/<AGENT_ACCOUNT_ID>.json (near-cli format).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { createAgent, loadSecretKey } from './client.js';

const baseUrl = (process.env.GATEWAY_URL || 'https://near.ochinimus.app').replace(/\/$/, '');
const accountId = process.env.AGENT_ACCOUNT_ID;
if (!accountId) { console.error('AGENT_ACCOUNT_ID is required'); process.exit(2); }
let secretKey = process.env.AGENT_PRIVATE_KEY;
try { secretKey ||= loadSecretKey(accountId); } catch (e) { console.error(`AGENT_PRIVATE_KEY is required (${e.message})`); process.exit(2); }
const agent = createAgent({ accountId, secretKey, baseUrl, maxPriceUsdc: Number(process.env.MAX_PRICE_USDC || 0.1) });

const server = new McpServer({ name: 'agentfeed-near', version: '0.1.0' });
const text = (o) => ({ content: [{ type: 'text', text: typeof o === 'string' ? o : JSON.stringify(o, null, 2) }] });

server.registerTool('list_routes', {
  description: 'List the AgentFeed routes sold for USDC on NEAR testnet with their prices. Free, spends nothing.',
  inputSchema: {},
  // Reads the gateway manifest only: no state changes, same answer for the same state, talks to a remote service.
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
}, async () => {
  const m = await (await fetch(`${baseUrl}/.well-known/x402`)).json();
  return text({ network: m.network, token: m.asset, payTo: m.payTo, routes: m.routes.map((r) => ({ id: r.id, price_usdc: r.price_usdc, params: r.params, description: r.description })) });
});

server.registerTool('call_route', {
  description: 'Pay for and call one AgentFeed route in USDC on NEAR testnet (signs one NEP-366 delegate action; the gateway relays it and pays the gas, so the agent account needs USDC and no NEAR). Returns the data and the NEAR explorer link of the settlement. Spends USDC from the agent account.',
  inputSchema: {
    route: z.string().describe('route id from list_routes, e.g. "sol-price", "liquidations", "summarize"'),
    params: z.record(z.string(), z.string()).optional().describe('query parameters, e.g. {"url":"https://example.com"} for summarize'),
  },
  // Spends USDC from the agent account and calls a remote gateway. Each call is a new payment, so it is not idempotent;
  // it moves funds but does not destroy or overwrite anything, so it is not destructive in the MCP sense.
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
}, async ({ route, params }) => {
  try {
    const r = await agent.call(route, params || {});
    if (!r.ok) return { isError: true, ...text({ status: r.status, error: r.body.error, charged: r.body.charged, message: r.body.message }) };
    return text({ paid: r.body.paid, data: r.body.data });
  } catch (e) { return { isError: true, ...text(String(e.message || e)) }; }
});

await server.connect(new StdioServerTransport());
