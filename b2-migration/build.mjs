import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function validateConfig(config) {
  const f = config.firebase || {};
  if (!f.apiKey || !f.appId || !/^[a-z][a-z0-9-]{4,29}$/.test(f.projectId || '') ||
      JSON.stringify(config).includes('civic-voice-530e3') || /REPLACE|NEW_PROJECT|NEW_DATABASE|YOUR_SUBDOMAIN|NEW_FIREBASE/.test(JSON.stringify(config))) throw new Error('Supply a real NEW Firebase project configuration, never the live project.');
  const db = new URL(f.databaseURL), api = new URL(config.mediaApi);
  if (db.protocol !== 'https:' || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(db.hostname) || db.pathname !== '/' || db.search || db.hash) throw new Error('Invalid staging database URL');
  if (api.protocol !== 'https:' || api.pathname !== '/' || api.search || api.hash || api.username || api.password) throw new Error('Invalid media API URL');
  return config;
}
export function transform(name, source, config) {
  validateConfig(config);
  if (name === 'display.html') {
    return source.replaceAll('https://civic-voice-530e3-default-rtdb.firebaseio.com', config.firebase.databaseURL.replace(/\/$/, ''));
  }
  const pattern = /((?:var|const) firebaseConfig\s*=\s*)\{[\s\S]*?\};/;
  if (!pattern.test(source)) throw new Error('Firebase configuration location changed; refusing unsafe build');
  let result = source.replace(pattern, (_, declaration) => declaration + JSON.stringify(config.firebase, null, 12) + ';');
  if (name === 'admin.html') {
    const storageLine = `const storage = window.PanelB2Storage(auth, ${JSON.stringify(config.mediaApi.replace(/\/$/, ''))});`;
    if (result.includes('const storage = firebase.storage();')) result = result.replace('const storage = firebase.storage();', storageLine);
    else if (result.includes('const storage = window.PanelB2Storage(')) result = result.replace(/const storage = window.PanelB2Storage\(auth, [^\n]+\);/, storageLine);
    else throw new Error('Storage integration location changed');
    if (!result.includes('<script src="browser-storage.js">')) {
    result = result.replace(/(<script>\s*\/\/ Firebase Configuration)/, '<script src="browser-storage.js"></script>\n$1');
    if (!result.includes('<script src="browser-storage.js">')) {
      // The admin's inline block has a different comment from the login page.
      result = result.replace(/(<script>\s*(?:const|\/\/)[\s\S]*?const firebaseConfig)/, '<script src="browser-storage.js"></script>\n$1');
    }
    if (!result.includes('<script src="browser-storage.js">')) throw new Error('Cannot inject staging storage adapter safely');
    }
    // Never swallow storage deletion errors and then erase metadata in the staging version.
    result = result.replace(/await storage\.ref\(([^\n]+?)\)\.delete\(\)\.catch\([^\n]+\);/g, 'await storage.ref($1).delete();');
  }
  return result;
}
export function build(config, output, root) {
  validateConfig(config);
  if (fs.existsSync(output)) throw new Error('Output already exists; choose a fresh build directory.');
  const files = {};
  for (const name of ['index.html', 'admin.html', 'display.html']) {
    files[name] = transform(name, fs.readFileSync(path.join(root, name), 'utf8'), config);
    if (files[name].includes('civic-voice-530e3')) throw new Error('Live-project reference remains; build refused');
  }
  fs.mkdirSync(output, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(output, name), content);
  fs.copyFileSync(path.join(root, 'media-cache.js'), path.join(output, 'media-cache.js'));
  fs.copyFileSync(new URL('./browser-storage.js', import.meta.url), path.join(output, 'browser-storage.js'));
  for (const name of ['access-control.js', 'media-management.js']) fs.copyFileSync(path.join(root, name), path.join(output, name));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const configPath = process.argv[2];
  if (!configPath) throw new Error('Usage: node build.mjs PRIVATE_CONFIG_JSON [NEW_OUTPUT_DIRECTORY]');
  const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
  const output = path.resolve(process.argv[3] || path.join(root, '.migration-private', 'staging-site-' + Date.now()));
  if (output === root || !output.startsWith(root + path.sep)) throw new Error('Build output must be a new directory inside this repository.');
  build(JSON.parse(fs.readFileSync(configPath, 'utf8')), output, root);
  console.log('Created isolated staging site: ' + output);
}
