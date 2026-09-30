# data/

For **local mode** only: unzip `landscapers-inc-PRIVATE-data.zip` into `data/seed/` here, so that `data/seed/manifest.json` exists.

The data pack is private. Never upload `data/seed/` to a website or commit it to Git (`.gitignore` already excludes it). In Supabase mode the same data is loaded once with `06_seed.sql` and this folder stays empty. See [../README.md](../README.md) and [../docs/DATA-PACK.md](../docs/DATA-PACK.md).
