const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function landingHtml({ cfg, routes, priceUsdc, relayer }) {
  const rows = routes.map((r) => `<tr><td><code>/api/${esc(r.id)}</code></td><td>${priceUsdc(r)} USDC</td><td>${esc(r.description)}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>agentfeed-near</title>
<style>:root{color-scheme:light dark}body{font:16px/1.5 system-ui,sans-serif;max-width:46rem;margin:2rem auto;padding:0 1rem}code,pre{font:14px ui-monospace,monospace}pre{background:#8881;padding:.75rem;overflow:auto;border-radius:6px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #8884;padding:.35rem .5rem;text-align:left}</style></head><body>
<h1>agentfeed-near</h1>
<p>AI agents buy <a href="https://x402.ochinimus.app">AgentFeed</a> market data per call and pay in <strong>USDC on NEAR testnet</strong>. The agent signs one NEP-366 delegate action off-chain; this gateway relays it and pays the gas, so the agent needs USDC only.</p>
<pre>curl -i ${esc(cfg.publicUrl)}/api/sol-price
HTTP/2 402   payment-required: &lt;base64 x402 v2: exact, ${esc(cfg.network)}, ${esc(cfg.usdc.asset.slice(0, 8))}…, payTo ${esc(cfg.treasury)}&gt;</pre>
<table><tr><th>route</th><th>price</th><th>what</th></tr>${rows}</table>
<p>Live: <a href="/stats">/stats</a> · <a href="/payments.csv">/payments.csv</a> · <a href="/.well-known/x402">/.well-known/x402</a> · relayer <code>${esc(relayer)}</code> · treasury <code>${esc(cfg.treasury)}</code></p>
<p>Testnet only. Source and the five-minute judge path: <a href="https://github.com/seekdaseek/agentfeed-near">github.com/seekdaseek/agentfeed-near</a>.</p>
</body></html>`;
}
