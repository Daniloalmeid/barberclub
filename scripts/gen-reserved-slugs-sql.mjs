import { RESERVED_PREFIXES, RESERVED_SLUGS } from "../packages/config/src/reserved.ts";

const slugs = RESERVED_SLUGS.map((slug) => `  ('${slug}', 'system')`).join(",\n");
const prefixes = RESERVED_PREFIXES.map((prefix) => `  ('${prefix}')`).join(",\n");
process.stdout.write(`insert into public.reserved_slugs (slug, reason) values\n${slugs}\non conflict (slug) do nothing;\n\ninsert into public.reserved_slug_prefixes (prefix) values\n${prefixes}\non conflict (prefix) do nothing;\n`);
