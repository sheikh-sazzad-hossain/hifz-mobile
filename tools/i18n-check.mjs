// Lists what is missing in each language pack and checks that {placeholders} (and HTML tags) match the Bengali source.
//   node tools/i18n-check.mjs [code ...]        e.g. node tools/i18n-check.mjs en de     (no code: all i18n/*.json)
//   node tools/i18n-check.mjs --ids de          prints only the missing string ids of de, one per line (for the translator)
// Exit code 1 when a placeholder / tag mismatch or an unknown id is found; missing keys alone do not fail (they fall back to Bengali).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const base = JSON.parse(readFileSync(`${root}data/ui-strings.json`, 'utf8'));
const schema = JSON.parse(readFileSync(`${root}data/settings-schema.json`, 'utf8'));
const CODES = ['en', 'ar', 'ur', 'hi', 'id', 'ms', 'tr', 'fa', 'fr', 'es', 'pt', 'de', 'ru', 'zh', 'sw'];
const args = process.argv.slice(2);
const idsOnly = args[0] === '--ids';
const want = (idsOnly ? args.slice(1) : args).length ? (idsOnly ? args.slice(1) : args) : CODES;

export const placeholders = (s) => [...String(s).matchAll(/\{[\w:]+\}/g)].map((m) => m[0]).sort().join(',');
export const tags = (s) => [...String(s).matchAll(/<\/?[a-z][^>]*>/gi)].map((m) => m[0].replace(/\s+/g, ' ')).sort().join(',');

export function checkPack(code, pack) {
  const out = { code, missing: [], missingSettings: [], missingGroups: [], missingPresets: [], bad: [], unknown: [] };
  const S = pack.strings ?? {};
  for (const id of Object.keys(base)) {
    if (!(id in S)) { out.missing.push(id); continue; }
    if (placeholders(S[id]) !== placeholders(base[id])) out.bad.push(`${id}: placeholders ${placeholders(base[id]) || '-'} -> ${placeholders(S[id]) || '-'}`);
    if (tags(S[id]) !== tags(base[id])) out.bad.push(`${id}: html tags differ`);
  }
  for (const id of Object.keys(S)) if (!(id in base)) out.unknown.push(id);
  for (const d of schema.settings) {
    const o = pack.settings?.[d.id];
    if (!o) { out.missingSettings.push(d.id); continue; }
    if (d.id === 'view.lang') continue;
    if (d.help && !o.help) out.missingSettings.push(`${d.id}.help`);
    if (d.sub && !o.sub) out.missingSettings.push(`${d.id}.sub`);
    for (const x of d.options ?? []) if (x.label !== undefined && !o.options?.[String(x.v)]) out.missingSettings.push(`${d.id}.options.${x.v}`);
    if (o.help && placeholders(o.help) !== placeholders(d.help ?? '')) out.bad.push(`${d.id}.help: placeholders differ`);
  }
  for (const id of Object.keys(pack.settings ?? {})) if (!schema.settings.some((d) => d.id === id)) out.unknown.push(`settings.${id}`);
  for (const g of schema.groups) if (!pack.groups?.[g.id]) out.missingGroups.push(g.id);
  for (const [g, p] of Object.entries(schema.presets ?? {})) {
    if (!pack.presets?.[g]?.label) out.missingPresets.push(`${g}.label`);
    for (const i of p.items) if (!pack.presets?.[g]?.items?.[i.id]?.label) out.missingPresets.push(`${g}.${i.id}`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let fail = false;
  for (const code of want) {
    const f = `${root}i18n/${code}.json`;
    if (!existsSync(f)) { if (!idsOnly) console.log(`${code}: no file (all ${Object.keys(base).length} strings missing)`); else console.log(Object.keys(base).join('\n')); continue; }
    const r = checkPack(code, JSON.parse(readFileSync(f, 'utf8')));
    if (idsOnly) { console.log(r.missing.join('\n')); continue; }
    console.log(`${code}: strings missing ${r.missing.length}/${Object.keys(base).length}, settings missing ${r.missingSettings.length}, groups ${r.missingGroups.length}, presets ${r.missingPresets.length}, placeholder/tag problems ${r.bad.length}, unknown ids ${r.unknown.length}`);
    for (const b of r.bad) console.log(`  BAD  ${b}`);
    for (const u of r.unknown) console.log(`  UNKNOWN  ${u}`);
    if (r.bad.length || r.unknown.length) fail = true;
  }
  process.exit(fail ? 1 : 0);
}
