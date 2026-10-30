// Uploads one photo to YouCam and starts a Skin Analysis task.
// The key stays on the server; live analysis stops when the balance gets low.
const BASE = 'https://yce-api-01.makeupar.com';
const ACTIONS = ['pore', 'texture', 'wrinkle', 'age_spot', 'acne', 'radiance'];
const RESERVE = 60;
const MAX_BYTES = 4 * 1024 * 1024;

export async function onRequestPost({ request, env }) {
  const auth = { Authorization: `Bearer ${env.YOUCAM_API_KEY}`, 'Content-Type': 'application/json' };
  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > MAX_BYTES) return Response.json({ error: 'Photo must be under 4 MB.' }, { status: 413 });

  const credit = await (await fetch(`${BASE}/s2s/v1.0/client/credit`, { headers: auth })).json();
  const left = (credit.results || []).reduce((s, x) => s + x.amount_dec, 0);
  if (left < RESERVE) return Response.json({ error: 'budget', left }, { status: 429 });

  const file = await (await fetch(`${BASE}/s2s/v2.0/file/skin-analysis`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ files: [{ content_type: 'image/jpeg', file_name: 'photo.jpg', file_size: bytes.byteLength }] }),
  })).json();
  const entry = file.data?.files?.[0];
  if (!entry) return Response.json({ error: 'Upload was refused.' }, { status: 502 });
  const put = entry.requests[0];
  const sent = await fetch(put.url, { method: 'PUT', headers: put.headers, body: bytes });
  if (!sent.ok) return Response.json({ error: 'Upload failed.' }, { status: 502 });

  const task = await (await fetch(`${BASE}/s2s/v2.1/task/skin-analysis`, {
    method: 'POST', headers: auth,
    body: JSON.stringify({ src_file_id: entry.file_id, dst_actions: ACTIONS, format: 'json', miniserver_args: { enable_mask_overlay: false } }),
  })).json();
  const id = task.data?.task_id;
  if (!id) return Response.json({ error: 'Skin Analysis refused this photo.', detail: task }, { status: 422 });
  return Response.json({ id });
}
