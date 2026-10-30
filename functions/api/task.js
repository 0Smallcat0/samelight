// Polls a Skin Analysis task and returns only the scores.
const BASE = 'https://yce-api-01.makeupar.com';

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get('id');
  if (!id) return Response.json({ error: 'Missing id.' }, { status: 400 });
  const res = await (await fetch(`${BASE}/s2s/v2.1/task/skin-analysis/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${env.YOUCAM_API_KEY}` },
  })).json();
  const data = res.data || res;
  if (data.task_status === 'error') return Response.json({ status: 'error', error: data.error });
  if (data.task_status !== 'success') return Response.json({ status: 'running' });
  const scores = {};
  for (const item of data.results.output) if ('raw_score' in item) scores[item.type] = item.raw_score;
  return Response.json({ status: 'done', scores });
}
