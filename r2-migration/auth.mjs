let keyCache = { expires: 0, keys: [] };
const keyEndpoint = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
function decode(value) {
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
}
export async function verifyFirebaseToken(token, project, { fetcher = fetch, now = Date.now(), subtle = crypto.subtle } = {}) {
  if (!token || token.length > 16000 || !project || project.includes('REPLACE')) throw new Error('Unauthorized');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Unauthorized');
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  const seconds = Math.floor(now / 1000);
  if (header.alg !== 'RS256' || !header.kid || claims.aud !== project ||
      claims.iss !== `https://securetoken.google.com/${project}` ||
      typeof claims.exp !== 'number' || claims.exp <= seconds ||
      typeof claims.iat !== 'number' || claims.iat > seconds ||
      typeof claims.auth_time !== 'number' || claims.auth_time > seconds ||
      typeof claims.sub !== 'string' || !claims.sub || claims.sub.length > 128 ||
      claims.email_verified !== true || typeof claims.email !== 'string') throw new Error('Unauthorized');
  if (keyCache.expires <= now) {
    const response = await fetcher(keyEndpoint, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Identity provider unavailable');
    const { keys } = await response.json();
    if (!Array.isArray(keys)) throw new Error('Identity provider unavailable');
    const ttl = Number((response.headers.get('Cache-Control') || '').match(/max-age=(\d+)/)?.[1] || 300);
    keyCache = { keys, expires: now + Math.min(ttl, 3600) * 1000 };
  }
  const jwk = keyCache.keys.find(key => key.kid === header.kid);
  if (!jwk) throw new Error('Unauthorized');
  const key = await subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1]))) throw new Error('Unauthorized');
  return claims;
}
export async function authorize(token, dept, env) {
  const claims = await verifyFirebaseToken(token, env.FIREBASE_PROJECT_ID);
  const base = env.FIREBASE_DATABASE_URL;
  if (!/^https:\/\/[a-z0-9-]+\.(firebaseio\.com|[a-z0-9-]+\.firebasedatabase\.app)$/.test(base) || base.includes('civic-voice-530e3')) throw new Error('Staging database not configured');
  const email = claims.email.toLowerCase();
  const key = email.replace(/\./g, '_').replace(/@/g, '_');
  async function read(path) {
    const url = new URL(`${base}/${path}.json`);
    url.searchParams.set('auth', token);
    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('Authorization unavailable');
    return response.json();
  }
  function active(record, minimum) {
    return record && record.active === true && record.email?.toLowerCase() === email && record.roleLevel >= minimum;
  }
  const global = await read(`users/${key}`);
  if (active(global, 3)) return claims;
  if (!dept || !active(await read(`dept/${dept}/users/${key}`), 1)) throw new Error('Forbidden');
  return claims;
}
