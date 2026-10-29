// Destination-only deployment with a private backup of the current rules.
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { destinationRules } from './rules.mjs';
const base = 'https://fx-panelsync-default-rtdb.firebaseio.com';
const token = execFileSync('gcloud.cmd', ['auth','print-access-token','--account=fxodapp@gmail.com'], {encoding:'utf8',shell:true,stdio:['ignore','pipe','pipe']}).trim();
const headers = {Authorization:'Bearer '+token,'Content-Type':'application/json'};
const existing = await fetch(base+'/.settings/rules.json',{headers});
if (!existing.ok) throw Error('Cannot back up destination rules');
fs.writeFileSync(new URL('../.migration-private/rules-before-'+Date.now()+'.json',import.meta.url),JSON.stringify(await existing.json(),null,2),{flag:'wx'});
const response = await fetch(base+'/.settings/rules.json',{method:'PUT',headers,body:JSON.stringify(destinationRules())});
if (!response.ok) throw Error('Rules deployment rejected: HTTP '+response.status);
console.log('Updated fx-panelsync rules only. Previous destination rules backed up privately.');
