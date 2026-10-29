// Validates a NEAR HACKATHON submission payload against the contract in https://nearhackathon.com/HACKATHON.md (read 2026-10-29) and prints
// the curl command. It NEVER sends anything: the owner confirms the printed payload and runs the command himself.
//   node scripts/check-submission.mjs --template                  prints a payload skeleton with <OWNER: ...> placeholders (invalid on purpose)
//   node scripts/check-submission.mjs path/to/payload.json [--online]   keep the payload file OUTSIDE the repository: it holds personal data
// --online also checks that the repository and the demo post open without logging in.
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export const SIZES = ['1', '2 - 4', '4 - 6', '6 - 8', '8+'];
export const TRACKS = ['defi', 'thesis', 'privacy', 'business', 'swarms', 'security', 'agents', 'realworld', 'games', 'nfts', 'memecoins', 'social', 'open'];
const FIELDS = ['requestId', 'projectName', 'leadName', 'email', 'size', 'tracks', 'nearAddress', 'projectUrl', 'demoUrl', 'idea', 'consent'];
const NEAR_ADDR = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validate(p) {
  const errs = [];
  const str = (k, min, max) => { if (typeof p[k] !== 'string') errs.push(`${k}: must be a string`); else if (p[k].length < min || p[k].length > max) errs.push(`${k}: ${p[k].length} characters, need ${min}-${max}`); return typeof p[k] === 'string'; };
  for (const k of Object.keys(p)) if (!FIELDS.includes(k)) errs.push(`${k}: not an allowed field${k === 'website' ? ' (spam trap: any value rejects the submission)' : ''}`);
  if (!UUID.test(String(p.requestId))) errs.push('requestId: must be a UUID');
  str('projectName', 2, 80); str('leadName', 2, 80);
  if (str('email', 3, 160) && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(p.email)) errs.push('email: not a valid address');
  if (!SIZES.includes(p.size)) errs.push(`size: one of ${SIZES.map((s) => `"${s}"`).join(', ')}, exactly as written`);
  if (!Array.isArray(p.tracks) || !p.tracks.length) errs.push('tracks: a non-empty array');
  else { for (const t of p.tracks) if (!TRACKS.includes(t)) errs.push(`tracks: unknown id "${t}"`); if (new Set(p.tracks).size !== p.tracks.length) errs.push('tracks: each id once'); }
  if (str('nearAddress', 2, 64) && !NEAR_ADDR.test(p.nearAddress)) errs.push('nearAddress: lowercase NEAR account id pattern');
  for (const k of ['projectUrl', 'demoUrl']) if (str(k, 8, 300) && !/^https?:\/\/\S+$/.test(p[k])) errs.push(`${k}: must be an http(s) URL`);
  str('idea', 20, 2000);
  if (p.consent !== true) errs.push('consent: must be the boolean true, only after the owner agreed to the contact notice');
  if (Buffer.byteLength(JSON.stringify(p)) > 12000) errs.push('body: over 12000 bytes');
  for (const [k, v] of Object.entries(p)) if (typeof v === 'string' && /<OWNER|XXXXXXXX/.test(v)) errs.push(`${k}: still a placeholder`);
  return errs;
}

export const template = () => ({
  requestId: randomUUID(), projectName: '<OWNER: 2-80 characters>', leadName: '<OWNER: team lead, 2-80 characters>', email: '<OWNER: contact email>', size: '<OWNER: one of 1, 2 - 4, 4 - 6, 6 - 8, 8+>',
  tracks: ['agents'], nearAddress: '<OWNER: mainnet payout account, lowercase>', projectUrl: 'https://github.com/seekdaseek/agentfeed-near', demoUrl: '<OWNER: link to the public X post>', idea: '<paste the idea from docs/SUBMISSION.md>', consent: false,
});

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args.includes('--template')) { console.log(JSON.stringify(template(), null, 2)); process.exit(0); }
  const file = args.find((a) => !a.startsWith('--'));
  if (!file) { console.error('usage: node scripts/check-submission.mjs --template | <payload.json> [--online]'); process.exit(2); }
  const p = JSON.parse(readFileSync(file, 'utf8'));
  const errs = validate(p);
  if (args.includes('--online')) {
    for (const k of ['projectUrl', 'demoUrl']) {
      try { const r = await fetch(p[k], { redirect: 'follow', signal: AbortSignal.timeout(20000), headers: { 'user-agent': 'Mozilla/5.0 submission-check' } }); if (!r.ok) errs.push(`${k}: ${r.status} without logging in (a private repository answers 404)`); }
      catch (e) { errs.push(`${k}: unreachable (${e.message})`); }
    }
    if (typeof p.projectUrl === 'string') for (const f of ['LICENSE', 'README.md']) {
      const raw = p.projectUrl.replace('https://github.com/', 'https://raw.githubusercontent.com/') + `/HEAD/${f}`;
      try { const r = await fetch(raw, { signal: AbortSignal.timeout(20000) }); if (!r.ok) errs.push(`repository has no public ${f} (${r.status})`); } catch (e) { errs.push(`${f}: ${e.message}`); }
    }
  }
  if (errs.length) { console.error(`${errs.length} problem(s):\n- ${errs.join('\n- ')}`); process.exit(1); }
  console.log('payload is valid. Print it to the owner, wait for his yes, then run (once; a retry reuses the same requestId):\n');
  console.log(`curl -sS -X POST https://nearhackathon.com/api/applications -H 'Content-Type: application/json' -d '${JSON.stringify(p).replaceAll("'", "'\\''")}'`);
}
