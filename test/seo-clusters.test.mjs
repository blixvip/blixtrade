import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TOPIC_CLUSTERS, PAGE_TOPIC } from '../worker/site/clusters.js';
import { buildClusterPlan } from '../scripts/seo-clusters.mjs';

test('all keywords have one topic and variants share canonical briefs without clearing product blockers', async () => {
  const source = await readFile(new URL('../docs/seo/keywords-source.txt', import.meta.url), 'utf8');
  const plan = buildClusterPlan(source);
  assert.equal(plan.length, 850);
  assert.equal(new Set(plan.map(row => row.keyword)).size, 850);
  for (const row of plan) assert.ok(TOPIC_CLUSTERS.some(topic => topic.id === row.topic), row.keyword);
  const byKeyword = new Map(plan.map(row => [row.keyword, row]));
  for (const keyword of ['ai meme coin maker', 'ai memecoin creator', 'ai pumpfun creator']) {
    const row = byKeyword.get(keyword);
    assert.equal(row.planned_canonical, '/ai-meme-coin-maker');
    assert.equal(row.dependency, 'ai-creator');
    assert.equal(row.current_canonical, '/ai-meme-coin-maker');
  }
  for (const keyword of ['pumpfun api', 'pump fun api', 'pump.fun api']) assert.equal(byKeyword.get(keyword).current_canonical, '/pump-fun-api');
  for (const keyword of ['meme coin scanner', 'memecoin scanner']) assert.equal(byKeyword.get(keyword).current_canonical, '/solana-memecoin-screener');
  const assigned = TOPIC_CLUSTERS.flatMap(topic => topic.pages);
  assert.equal(new Set(assigned).size, assigned.length, 'each resource has one primary topic');
  assert.equal(PAGE_TOPIC.size, assigned.length);
});
