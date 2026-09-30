"""Index every original company file (including files inside nested zips) for the Document Vault.

    python tools/vault_index.py <company-data.zip> <groups.json> <out: vault-index.json>

Each file gets a canonical `src` (the same path the readers used, e.g. "x/Invoices-…/Invoices/INVOICES JULY/X.pdf"),
its size, SHA-256, MIME type and the reader group that transcribed it. Identical files (same SHA-256) are
listed once with every place they appeared in `also_at`. Standard library only.
"""
import hashlib, io, json, mimetypes, os, sys, zipfile

MIME_EXTRA = {'.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.md': 'text/markdown', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.png': 'image/png', '.pdf': 'application/pdf'}


def mime(name):
    ext = os.path.splitext(name)[1].lower()
    return MIME_EXTRA.get(ext) or mimetypes.guess_type(name)[0] or 'application/octet-stream'


def key(path):
    """basename + parent folder, trimmed and lower-cased — survives the trailing-space folder names."""
    parts = [p.strip().lower() for p in path.replace('\\', '/').split('/') if p.strip()]
    return '|'.join(parts[-2:]) if len(parts) >= 2 else parts[-1]


def main(zip_path, groups_path, out_path):
    groups = json.load(open(groups_path, encoding='utf-8'))['groups']
    by_key, by_name = {}, {}
    for g in groups:
        for f in g['files']:
            by_key.setdefault(key(f['src']), (f['src'], g['key']))
            by_name.setdefault(os.path.basename(f['src']).strip().lower(), []).append((f['src'], g['key']))
    outer = zipfile.ZipFile(zip_path)
    entries = []

    def add(src_guess, data, where):
        k = key(src_guess)
        hit = by_key.get(k)
        if not hit:
            cands = by_name.get(os.path.basename(src_guess).strip().lower(), [])
            hit = cands[0] if len(cands) == 1 else None
        entries.append({'src': hit[0] if hit else src_guess, 'group': hit[1] if hit else None, 'name': os.path.basename(src_guess.rstrip('/')).strip(),
                        'size': len(data), 'sha256': hashlib.sha256(data).hexdigest(), 'mime': mime(src_guess), 'where': where})

    for info in outer.infolist():
        if info.is_dir():
            continue
        rel = info.filename.split('/', 1)[1] if '/' in info.filename else info.filename
        data = outer.read(info)
        if rel.lower().endswith('.zip'):
            stem = rel[:-4]
            inner = zipfile.ZipFile(io.BytesIO(data))
            for ii in inner.infolist():
                if ii.is_dir():
                    continue
                add(f'x/{stem}/{ii.filename}', inner.read(ii), [info.filename, ii.filename])
        else:
            add(f'x/{rel}', data, [info.filename])

    uniq, seen = [], {}
    for e in entries:
        if e['sha256'] in seen:
            seen[e['sha256']]['also_at'].append(e['src'])
            continue
        e['also_at'] = []
        seen[e['sha256']] = e
        uniq.append(e)
    json.dump({'source_zip': os.path.basename(zip_path), 'files': uniq}, open(out_path, 'w', encoding='utf-8'), indent=1)
    matched = sum(1 for e in uniq if e['group'])
    print(f'{len(entries)} files found, {len(uniq)} unique, {matched} matched to a reader group, {len(uniq) - matched} unmatched')
    for e in uniq:
        if not e['group']:
            print('  unmatched:', e['src'])


if __name__ == '__main__':
    main(*sys.argv[1:4])
