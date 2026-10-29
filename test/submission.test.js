// The submission validator against the contract of https://nearhackathon.com/HACKATHON.md, and the drafted idea text in docs/SUBMISSION.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validate, template, SIZES, TRACKS } from '../scripts/check-submission.mjs';

const good = () => ({
  requestId: '3f2a9c6e-1b7d-4c58-9a0e-5d4f8b2c7a11', projectName: 'agentfeed-near', leadName: 'Test Lead', email: 'lead@example.com', size: '1', tracks: ['agents'],
  nearAddress: 'team.near', projectUrl: 'https://github.com/seekdaseek/agentfeed-near', demoUrl: 'https://x.com/someone/status/1', idea: 'x'.repeat(40), consent: true,
});

describe('submission payload validator', () => {
  test('a complete payload passes', () => assert.deepEqual(validate(good()), []));
  test('the template is invalid on purpose (placeholders, consent false)', () => assert.ok(validate(template()).length >= 5));
  test('the template carries the two decided tracks', () => assert.deepEqual(template().tracks, ['agents', 'realworld']));
  const bad = {
    'project name too short': { projectName: 'a' }, 'project name too long': { projectName: 'a'.repeat(81) }, 'lead name missing': { leadName: undefined },
    'bad email': { email: 'nope' }, 'email over 160': { email: `${'a'.repeat(160)}@example.com` }, 'size not in the list': { size: '2-4' },
    'no tracks': { tracks: [] }, 'unknown track': { tracks: ['nonsense'] }, 'duplicate track': { tracks: ['agents', 'agents'] },
    'uppercase NEAR address': { nearAddress: 'Team.near' }, 'address too short': { nearAddress: 'a' },
    'repo URL not http(s)': { projectUrl: 'github.com/x/y' }, 'demo URL missing': { demoUrl: undefined },
    'idea under 20': { idea: 'short' }, 'idea over 2000': { idea: 'x'.repeat(2001) }, 'consent false': { consent: false }, 'consent as a string': { consent: 'true' },
    'requestId not a UUID': { requestId: '123' }, 'the website spam trap': { website: 'x' }, 'an unknown field': { extra: 1 },
  };
  for (const [name, patch] of Object.entries(bad)) test(`rejects: ${name}`, () => assert.ok(validate({ ...good(), ...patch }).length > 0));
  test('allowed sizes and tracks match the live contract', () => {
    assert.deepEqual(SIZES, ['1', '2 - 4', '4 - 6', '6 - 8', '8+']);
    assert.equal(TRACKS.length, 13);
    assert.ok(TRACKS.includes('agents') && TRACKS.includes('social'));
  });
});

describe('docs/SUBMISSION.md', () => {
  const md = readFileSync(new URL('../docs/SUBMISSION.md', import.meta.url), 'utf8');
  const idea = md.split('<!-- idea:start -->')[1]?.split('<!-- idea:end -->')[0]?.trim().replace(/^```\w*\n|\n```$/g, '');
  test('the drafted idea exists and fits 20-2000 characters', () => { assert.ok(idea, 'idea markers not found'); assert.ok(idea.length >= 20 && idea.length <= 2000, `idea is ${idea.length} characters`); });
  test('the idea starts with the headline and discloses prior work and testnet', () => {
    assert.match(idea, /^AI agents/);
    for (const must of ['existing product', 'testnet', 'StakeStreak', 'agents', 'realworld']) assert.ok(idea.includes(must), `idea lacks "${must}"`);
  });
  test('the X post draft fits 280 characters', () => {
    const post = md.split('<!-- post:start -->')[1]?.split('<!-- post:end -->')[0]?.trim().replace(/^```\w*\n|\n```$/g, '');
    assert.ok(post && post.length <= 280, `post is ${post?.length} characters`);
  });
});
