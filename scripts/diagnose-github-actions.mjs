#!/usr/bin/env node
const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (!token || !repository) {
  console.log('GITHUB_ACTIONS_DIAGNOSTIC unavailable');
  process.exit(0);
}
const response = await fetch('https://api.github.com/repos/' + repository + '/actions/workflows/deploy-cloudflare.yml/runs?per_page=8', {
  headers: {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  },
  signal: AbortSignal.timeout(20000)
});
if (!response.ok) {
  console.log('GITHUB_ACTIONS_DIAGNOSTIC HTTP ' + response.status);
  process.exit(0);
}
const payload = await response.json();
const runs = (payload.workflow_runs || []).map(run => ({
  id: run.id,
  event: run.event,
  head_sha: run.head_sha,
  status: run.status,
  conclusion: run.conclusion,
  created_at: run.created_at,
  updated_at: run.updated_at,
  run_number: run.run_number,
  html_url: run.html_url
}));
console.log('CLOUDFLARE_DEPLOY_RUNS ' + JSON.stringify(runs));
