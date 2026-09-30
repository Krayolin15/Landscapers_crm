// Static check:  node tools/check.mjs
// 1. every JS module parses (node --check, ESM)
// 2. every static import resolves to an existing file
// 3. every named import is actually exported by that file
// 4. no forbidden patterns (innerHTML assignment with data, eval, new Function, document.write)
// 5. every app in the registry has index.js + plugin.js
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const files = [];
(function walk(d) { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(m?js)$/.test(f)) files.push(p); } })(join(root, 'js'));

let errors = 0, warnings = 0;
const err = (f, m) => { errors++; console.error(`✗ ${relative(root, f)}: ${m}`); };
const warn = (f, m) => { warnings++; console.warn(`! ${relative(root, f)}: ${m}`); };

const exportsCache = new Map();
function exportsOf(file) {
  if (exportsCache.has(file)) return exportsCache.get(file);
  const src = readFileSync(file, 'utf8');
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) m[1].split(',').map(s => s.trim()).filter(Boolean).forEach(s => names.add(s.split(/\s+as\s+/).pop().trim()));
  if (/export\s+default\b/.test(src)) names.add('default');
  for (const m of src.matchAll(/export\s+\*\s+from\s+['"]([^'"]+)['"]/g)) { const t = resolve(dirname(file), m[1]); if (existsSync(t)) exportsOf(t).forEach(n => names.add(n)); }
  exportsCache.set(file, names);
  return names;
}

for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { err(f, 'syntax error\n' + String(e.stderr || e.message).split('\n').slice(0, 6).join('\n')); continue; }
  const src = readFileSync(f, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[2];
    if (!spec.startsWith('.')) continue;
    const target = resolve(dirname(f), spec);
    if (!existsSync(target)) { err(f, `imports missing file ${spec}`); continue; }
    const clause = m[1];
    const named = /\{([\s\S]*)\}/.exec(clause);
    const ex = exportsOf(target);
    if (named) for (const part of named[1].split(',').map(s => s.trim()).filter(Boolean)) {
      const name = part.split(/\s+as\s+/)[0].trim();
      if (name && !ex.has(name)) err(f, `imports { ${name} } but ${spec} does not export it`);
    }
    const def = clause.replace(/\{[\s\S]*\}/, '').replace(/\*\s+as\s+\w+/, '').replace(/,/g, '').trim();
    if (def && !ex.has('default')) err(f, `imports default from ${spec} which has no default export`);
  }
  if (/\.innerHTML\s*=(?!=)/.test(code) && !/sanitize\.js$/.test(f)) err(f, 'assigns innerHTML — use h() or the sanitiser');
  if (/\beval\s*\(|new Function\s*\(|document\.write\s*\(/.test(code)) err(f, 'uses eval/new Function/document.write');
  if (/\bconsole\.log\(/.test(code)) warn(f, 'console.log left in');
}

// registry completeness
const reg = readFileSync(join(root, 'js/apps/registry.js'), 'utf8');
// only APPS entries (they have a name:), not GROUPS
for (const m of reg.matchAll(/\{\s*id:\s*'([\w-]+)',\s*name:/g)) {
  const id = m[1];
  if (!existsSync(join(root, 'js/apps', id, 'index.js'))) err(join(root, 'js/apps/registry.js'), `app "${id}" has no js/apps/${id}/index.js`);
  if (!existsSync(join(root, 'js/apps', id, 'plugin.js'))) err(join(root, 'js/apps/registry.js'), `app "${id}" has no js/apps/${id}/plugin.js`);
}

console.log(`\n${files.length} modules checked · ${errors} error(s) · ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);
