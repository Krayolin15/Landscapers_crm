"""Build the private Document Vault zip that Drive imports at #/drive/import.

    python tools/build_vault.py <company-data.zip> <vault-index.json> <data-pack-dir> <out.zip>

Reads every original file straight out of the company zip (and its nested zips), and writes it as
"<SHARED DRIVE>/<folder>/<file>" plus manifest.json. The manifest's file_id / drive / folder_path / linked
come from the data pack (files.json, folders.json, drives.json built by tools/seed/90-vault.mjs), so the
importer attaches each file to the record the app already shows as "pending import".
"""
import hashlib, io, json, os, sys, zipfile


def main(src_zip, index_path, pack_dir, out_zip):
    index = json.load(open(index_path, encoding='utf-8'))
    files = {f['sha256']: f for f in json.load(open(os.path.join(pack_dir, 'files.json'), encoding='utf-8'))}
    folders = {f['id']: f for f in json.load(open(os.path.join(pack_dir, 'folders.json'), encoding='utf-8'))}
    drives = {d['id']: d for d in json.load(open(os.path.join(pack_dir, 'drives.json'), encoding='utf-8'))}

    def folder_path(fid):
        parts = []
        while fid:
            f = folders[fid]
            parts.insert(0, f['name'])
            fid = f.get('parent_id')
        return '/'.join(parts)

    outer = zipfile.ZipFile(src_zip)
    nested = {}

    def read(where):
        if len(where) == 1:
            return outer.read(where[0])
        if where[0] not in nested:
            nested[where[0]] = zipfile.ZipFile(io.BytesIO(outer.read(where[0])))
        return nested[where[0]].read(where[1])

    manifest, used = [], set()
    with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for e in index['files']:
            rec = files.get(e['sha256'])
            if not rec:
                print('  no file record for', e['src'])
                continue
            data = read(e['where'])
            assert hashlib.sha256(data).hexdigest() == e['sha256'], e['src']
            drive = drives[rec['drive_id']]['name']
            fpath = folder_path(rec.get('folder_id'))
            path = '/'.join(p for p in [drive, fpath, rec['name']] if p)
            base, n = path, 2
            while path.lower() in used:  # same name twice in one folder
                stem, ext = os.path.splitext(base)
                path, n = f'{stem} ({n}){ext}', n + 1
            used.add(path.lower())
            z.writestr(path, data)
            manifest.append({'path_in_zip': path, 'drive': drive, 'folder_path': fpath, 'name': os.path.basename(path), 'mime': rec['mime'], 'size': len(data),
                             'sha': e['sha256'], 'linked': rec.get('linked', []), 'confidential': bool(rec.get('confidential')), 'expires_on': rec.get('expires_on'),
                             'description': rec.get('description'), 'file_id': rec['id'], 'original_path': e['src']})
        z.writestr('manifest.json', json.dumps({'kind': 'landscapers-inc-document-vault', 'version': 1, 'drives': [d['name'] for d in drives.values()], 'files': manifest}, indent=1))
    print(f'vault: {len(manifest)} files -> {out_zip} ({os.path.getsize(out_zip) / 1e6:.1f} MB)')


if __name__ == '__main__':
    main(*sys.argv[1:5])
