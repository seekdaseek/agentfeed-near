// Documents agents and directory crawlers read: an OpenAPI 3.1 file with x-payment-info on every paid route (the shape x402scan's
// DISCOVERY.md and @agentcash/discovery use) and a plain-text llms.txt. Both say, in the first lines, that this is NEAR TESTNET.

export function openapiDoc({ cfg, routes, priceUsdc, priceAtomic, relayer }) {
  const paths = {};
  for (const r of routes) {
    const params = Object.entries(r.params).map(([name, spec]) => ({
      name, in: 'query', required: spec.endsWith('!'),
      schema: { type: spec.replace('!', '') === 'int' ? 'integer' : spec.replace('!', '') === 'number' ? 'number' : 'string' },
    }));
    paths[`/api/${r.id}`] = {
      get: {
        operationId: r.id.replaceAll('-', '_'),
        summary: r.title,
        description: `${r.description} Paid in Circle testnet USDC on NEAR testnet (${priceUsdc(r)} USDC per call, no real value).`,
        parameters: params,
        'x-payment-info': {
          protocols: [{ x402: {} }],
          price: { mode: 'fixed', currency: 'USD', amount: priceUsdc(r) },
          network: cfg.network,
          asset: cfg.usdc.asset,
          payTo: cfg.treasury,
          amountAtomic: String(priceAtomic(r)),
        },
        responses: {
          200: { description: 'The data, with the settlement transaction in the PAYMENT-RESPONSE header and in the body (paid.tx, paid.explorer).', content: { 'application/json': { schema: { type: 'object' } } } },
          402: { description: 'Payment required: x402 v2, scheme exact, network near:testnet. The challenge is in the PAYMENT-REQUIRED header (base64 JSON) and in the body.' },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'agentfeed-near',
      version: '0.1.0',
      description: 'AgentFeed market data for AI agents, paid per call in Circle testnet USDC on NEAR TESTNET (x402 v2 exact, NEP-366 delegate actions; the gateway relays and pays the gas). Testnet only: the USDC has no value. Source: https://github.com/seekdaseek/agentfeed-near',
      'x-guidance': `Call GET a route without payment to receive the 402. Sign one NEP-366 delegate action carrying one ft_transfer of the stated amount of ${cfg.usdc.asset} to ${cfg.treasury} (1 yocto, 30 Tgas, window at most ${cfg.maxTimeoutSeconds} blocks) and send it base64-encoded in a PAYMENT-SIGNATURE header. Stock x402 NEAR clients (@x402/near, @fastnear/x402) do this unmodified.`,
    },
    servers: [{ url: cfg.publicUrl }],
    paths,
  };
}

export function llmsTxt({ cfg, routes, priceUsdc, relayer }) {
  const lines = [
    '# agentfeed-near',
    '',
    '> AgentFeed crypto market data for AI agents, paid per call in Circle testnet USDC on NEAR TESTNET. The agent signs one NEP-366 delegate action; this gateway relays it and pays the gas, so the agent needs USDC and no NEAR. Testnet only: nothing here has real value.',
    '',
    '## How to pay (x402 v2, scheme exact, network near:testnet)',
    `1. GET a route below. The 402 names the asset (${cfg.usdc.asset}, 6 decimals), payTo (${cfg.treasury}), the amount and a block window of ${cfg.maxTimeoutSeconds}.`,
    '2. Sign one delegate action with a FULL-ACCESS key: a single ft_transfer to payTo for exactly the amount, 1 yoctoNEAR attached, 30 Tgas. Function-call keys are refused.',
    '3. Retry the GET with the base64 payload in a PAYMENT-SIGNATURE header. The 200 carries the data and the settlement transaction (PAYMENT-RESPONSE header, body.paid.explorer).',
    'Stock clients work unmodified: @x402/near with @x402/fetch, or @fastnear/x402. The payer account must be storage-registered on the USDC contract (storage_deposit, 0.00125 NEAR once) and hold testnet USDC (https://faucet.circle.com, Near Testnet).',
    '',
    '## Routes',
    ...routes.map((r) => `- GET ${cfg.publicUrl}/api/${r.id}${Object.keys(r.params).length ? `?${Object.keys(r.params).join('&')}` : ''}: ${priceUsdc(r)} USDC. ${r.description}`),
    '',
    '## Machine-readable',
    `- ${cfg.publicUrl}/openapi.json (OpenAPI 3.1, x-payment-info per route)`,
    `- ${cfg.publicUrl}/.well-known/x402 (network, asset, payTo, relayer ${relayer}, routes)`,
    `- ${cfg.publicUrl}/stats and ${cfg.publicUrl}/payments.csv (the public ledger; every row is a NEAR testnet transaction)`,
    '',
    '## Honest notes',
    '- As of 2026-10-29 every settled call was bought by accounts of the builder and there was no independent payer; the current count is in docs/RESULTS.md in the repository.',
    '- Source: https://github.com/seekdaseek/agentfeed-near (MIT).',
    '',
  ];
  return lines.join('\n');
}
