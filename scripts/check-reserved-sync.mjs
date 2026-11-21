import { execSync } from "node:child_process";
import { RESERVED_PREFIXES, RESERVED_SLUGS } from "../packages/config/src/reserved.ts";

const cid = execSync("docker ps -qf name=supabase_db_").toString().trim().split("\n")[0];
if (!cid) {
  console.error("check-reserved-sync: postgres local ausente");
  process.exit(1);
}
function query(sql) {
  return execSync(`docker exec -u postgres ${cid} psql -U postgres -d postgres -tA -c ${JSON.stringify(sql)}`, {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean);
}
function diff(label, code, db) {
  const left = [...code].sort();
  const right = [...db].sort();
  const missing = left.filter((item) => !right.includes(item));
  const extra = right.filter((item) => !left.includes(item));
  if (missing.length || extra.length) {
    console.error(`${label} fora de sincronia`);
    console.error("so no codigo:", missing.join(","));
    console.error("so no banco:", extra.join(","));
    process.exit(1);
  }
}
diff("slugs", RESERVED_SLUGS, query("select slug from public.reserved_slugs"));
diff("prefixos", RESERVED_PREFIXES, query("select prefix from public.reserved_slug_prefixes"));
console.log("reservados sincronizados");
