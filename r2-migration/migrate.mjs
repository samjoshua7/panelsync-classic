/* Explicit, destination-only migration. No source write/delete API exists here. */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { validateConfig } from './build.mjs';
import { parseKey } from './worker.mjs';
import { destinationRules } from './rules.mjs';
const sourceBase = 'https://civic-voice-530e3-default-rtdb.firebaseio.com';
const sourceBucket = 'civic-voice-530e3.firebasestorage.app';
const privateDir = fileURLToPath(new URL('../.migration-private/', import.meta.url));
const digest = value => createHash('sha256').update(value).digest('hex');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
const equal = (a, b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
function cloudToken(account) {
  if (!/^[a-zA-Z0-9_.+@-]+$/.test(account || '')) throw new Error('Supply an explicit Google account email');
  return execFileSync(process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud', ['auth', 'print-access-token', '--account=' + account], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
async function readJSON(url, token) {
  const response = await fetch(url, { headers: { Authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error('Read failed (HTTP ' + response.status + '); no data changed');
  return response.json();
}
export function inventory(data) {
  const assets = new Map();
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.thumbnailUrl) throw new Error('Thumbnail migration needs explicit handling; refusing to leave a source URL behind');
    if (value.url) {
      const url = new URL(value.url);
      const match = /^\/v0\/b\/([^/]+)\/o\/(.+)$/.exec(url.pathname);
      if (url.protocol !== 'https:' || url.hostname !== 'firebasestorage.googleapis.com' || !match || match[1] !== sourceBucket) throw new Error('Unexpected source media host/bucket; inspect privately before migration');
      const key = decodeURIComponent(match[2]); parseKey(key);
      if (value.storagePath && value.storagePath !== key) throw new Error('Source URL/path mismatch');
      value.storagePath = key;
      if (!assets.has(key)) assets.set(key, []);
      assets.get(key).push(value);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') visit(child);
  }
  for (const dept of Object.values(data.dept || {})) {
    for (const node of ['media', 'disabled_media', 'background', 'music']) visit(dept[node]);
  }
  return assets;
}
export async function exportSource(account) {
  const token = cloudToken(account);
  const data = {};
  for (const node of ['depts', 'dept', 'users']) data[node] = await readJSON(`${sourceBase}/${node}.json`, token);
  const rules = await readJSON(`${sourceBase}/.settings/rules.json`, token);
  const serialized = JSON.stringify(data);
  fs.mkdirSync(privateDir, { recursive: true });
  const name = path.join(privateDir, 'source-' + Date.now() + '.json');
  fs.writeFileSync(name, JSON.stringify({ sourceProject: 'civic-voice-530e3', exportedAt: new Date().toISOString(), sha256: digest(serialized), data, sourceRules: rules }, null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Private source snapshot created: ' + name);
  return name;
}
export async function migrate(config, snapshotFile, apply) {
  validateConfig(config);
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  if (snapshot.sourceProject !== 'civic-voice-530e3' || digest(JSON.stringify(snapshot.data)) !== snapshot.sha256) throw new Error('Source snapshot integrity check failed');
  const data = structuredClone(snapshot.data), assets = inventory(data);
  data.users = data.users || {};
  const seed = { users: data.users, depts: data.depts, dept: {} };
  for (const [dept, value] of Object.entries(data.dept || {})) if (value.users) seed.dept[dept] = { users: value.users };
  console.log('Plan: ' + Object.keys(data.dept || {}).length + ' departments, ' + assets.size + ' unique PanelSync media files. Complaints/Firestore are excluded.');
  if (!apply) { console.log('DRY RUN: no network writes or media downloads. Add --apply only after reviewing staging configuration.'); return; }
  const sourceToken = cloudToken(config.sourceAccount);
  const targetToken = cloudToken(config.targetAccount);
  const identity = await readJSON('https://www.googleapis.com/oauth2/v3/userinfo', targetToken);
  const email = identity.email?.toLowerCase();
  const emailKey = email?.replace(/\./g, '_').replace(/@/g, '_');
  let superUser = seed.users?.[emailKey];
  if (identity.email_verified && config.bootstrapAdminEmail?.toLowerCase() === email) {
    if (superUser && superUser.email?.toLowerCase() !== email) throw new Error('Bootstrap email-key collision; no writes performed');
    // An explicitly configured destination bootstrap is never written to the source.
    superUser = { email, active: true, role: 'super', roleLevel: 3 };
    seed.users[emailKey] = superUser;
  }
  if (!identity.email_verified || !superUser || superUser.active !== true || superUser.roleLevel !== 3 || superUser.email?.toLowerCase() !== email) throw new Error('Target Google account must be a migrated Super User or explicitly configured bootstrapAdminEmail. No destination writes performed.');
  const base = config.firebase.databaseURL.replace(/\/$/, '');
  async function writeDestination(suffix, value) {
    const response = await fetch(`${base}/${suffix}.json`, { method: 'PUT', headers: { Authorization: 'Bearer ' + targetToken, 'Content-Type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error('Destination write failed (HTTP ' + response.status + ')');
  }
  const existing = await readJSON(base + '/.json', targetToken);
  if (existing && !equal(existing, seed)) throw new Error('Destination is not empty or exactly this migration bootstrap. Refusing to overwrite existing data.');
  // Bootstrap contains no media URLs; opening staging cannot stream the old media.
  if (!existing) await writeDestination('', seed);
  const signIn = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=' + encodeURIComponent(config.firebase.apiKey), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestUri: config.authRequestUri || 'http://127.0.0.1:5501', postBody: new URLSearchParams({ access_token: targetToken, providerId: 'google.com' }).toString(), returnSecureToken: true })
  });
  if (!signIn.ok) throw new Error('Destination Google sign-in failed; check provider and authorized domain. Only non-media bootstrap data was written.');
  const { idToken } = await signIn.json();
  // No old rules are copied; destination writes use role-aware rules including archives.
  await writeDestination('.settings/rules', destinationRules());
  let count = 0;
  for (const [key, records] of assets) {
    const sourceUrl = `https://storage.googleapis.com/storage/v1/b/${sourceBucket}/o/${encodeURIComponent(key)}?alt=media`;
    const response = await fetch(sourceUrl, { headers: { Authorization: 'Bearer ' + sourceToken }, signal: AbortSignal.timeout(600000) });
    if (!response.ok) throw new Error('Source media read failed; live source remains unchanged');
    const length = Number(response.headers.get('Content-Length'));
    if (!Number.isSafeInteger(length) || length <= 0 || length > 83886080) { await response.body.cancel(); throw new Error('Media exceeds migration size limit or lacks a valid length'); }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length !== length) throw new Error('Source download incomplete');
    const hash = digest(bytes);
    const type = response.headers.get('Content-Type')?.split(';')[0];
    const publicUrl = config.mediaApi.replace(/\/$/, '') + '/media/' + key.split('/').map(encodeURIComponent).join('/');
    let remote = await fetch(publicUrl, { method: 'HEAD' });
    if (remote.status === 404) {
      const upload = await fetch(config.mediaApi.replace(/\/$/, '') + '/api/object?key=' + encodeURIComponent(key), {
        method: 'PUT', headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': type, 'X-File-Size': String(length) }, body: bytes, signal: AbortSignal.timeout(600000)
      });
      if (upload.status !== 201) throw new Error('Staging upload failed (HTTP ' + upload.status + '); no playlist cutover performed');
    } else if (!remote.ok || Number(remote.headers.get('Content-Length')) !== length) throw new Error('Destination object conflict; inspect before resuming');
    // Verify full content, not just filename or size. R2 egress is free; requests still count.
    remote = await fetch(publicUrl, { signal: AbortSignal.timeout(600000) });
    if (!remote.ok || digest(new Uint8Array(await remote.arrayBuffer())) !== hash) throw new Error('Destination checksum verification failed');
    for (const record of records) { record.url = publicUrl; record.storageProvider = 'r2'; record.byteSize = length; record.sha256 = hash; }
    console.log('Verified media ' + (++count) + '/' + assets.size + ' (' + length + ' bytes)');
  }
  if (JSON.stringify(data).includes('firebasestorage.googleapis.com') || JSON.stringify(data).includes(sourceBucket)) throw new Error('Old media reference remains; no final import performed');
  // Check again: do not erase edits made while this migration was copying files.
  const latest = await readJSON(base + '/.json', targetToken);
  if (!equal(latest, seed)) throw new Error('Staging data changed during migration; refusing final overwrite');
  await writeDestination('', data);
  fs.mkdirSync(privateDir, { recursive: true });
  fs.writeFileSync(path.join(privateDir, 'verified-destination-' + Date.now() + '.json'), JSON.stringify(data, null, 2), { flag: 'wx', mode: 0o600 });
  console.log('Staging import complete. Source untouched. Real TV acceptance and explicit cutover are still required.');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, arg1, arg2, ...flags] = process.argv.slice(2);
  if (command === 'export') await exportSource(arg1);
  else if (command === 'plan' || command === 'copy') await migrate(JSON.parse(fs.readFileSync(arg1, 'utf8')), arg2, command === 'copy' && flags.includes('--apply'));
  else throw new Error('Usage: node migrate.mjs export SOURCE_ACCOUNT | plan CONFIG SNAPSHOT | copy CONFIG SNAPSHOT --apply');
}
