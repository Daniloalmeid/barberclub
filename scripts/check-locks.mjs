import { readFileSync, existsSync } from "node:fs";

const text = readFileSync("ops/locks.yml", "utf8");
const required = ["version:", "m1-fundacao", "backup-daily.sh", "traefik-drift-check.sh", "traefik-window.md", "backup.env.example"];
for (const piece of required) {
  if (!text.includes(piece)) {
    console.error(`ops/locks.yml sem ${piece}`);
    process.exit(1);
  }
}

const forbidden = [
  "scripts/backup-daily.sh",
  "scripts/traefik-drift-check.sh",
  "runbooks/traefik-window.md",
  "env/backup.env.example",
  ".github/workflows/backup.yml",
];
for (const path of forbidden) {
  if (existsSync(path)) {
    console.error(`artefato da VPS ou workflow de backup não pode estar no repositório: ${path}`);
    process.exit(1);
  }
}

const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
if (/backup-daily|pg_dump/.test(workflow)) {
  console.error("o CI não pode ter workflow de backup");
  process.exit(1);
}

console.log("travas ok");
