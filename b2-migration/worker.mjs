import handler, { MediaQuota as Quota } from './quota-worker.mjs';
import { B2Storage } from './b2-storage.mjs';
const clients = new WeakMap();
function storage(env) {
  if (!clients.has(env)) clients.set(env, new B2Storage(env));
  return clients.get(env);
}
export default {
  fetch(request, env) { return handler.fetch(request, { ...env, MEDIA: storage(env) }); }
};
export class MediaQuota extends Quota {
  constructor(ctx, env) { super(ctx, { ...env, MEDIA: new B2Storage(env) }); }
}
