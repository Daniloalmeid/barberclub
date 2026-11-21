import { createHmac } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

const edge = process.argv.includes("--edge");
const port = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 3471);
const B = "barber.workloop.com.br";
const rewritePath = "/tenant/x";
const nonce = process.env.BC_ROUTE_NONCE ?? "";
const secret = process.env.BC_ROUTE_SECRET ?? "";

function flag(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? "" : process.argv[index + 1] ?? "";
  return value.startsWith("--") ? "" : value;
}

function asHost(value) {
  if (!value) return "";
  return value.includes(".") ? value : `${value}.${B}`;
}

if (edge && (!flag("--host-a") || !flag("--host-b"))) {
  console.error("check-host-forgery: --edge exige --host-a e --host-b");
  process.exit(1);
}

const ativo = edge ? asHost(flag("--host-a")) : `ativo.${B}`;
const trial = edge ? asHost(flag("--host-b")) : `trial1.${B}`;
const base = ativo.split(".").slice(1).join(".");
const trialLabel = trial.split(".")[0];

function seal(pathname, host) {
  return createHmac("sha256", secret).update(`${nonce}\n${host}\n${pathname}`).digest("hex");
}

function decode(buffer, head) {
  if (!/transfer-encoding:\s*chunked/i.test(head)) return buffer.toString("utf8");
  const out = [];
  let offset = 0;
  while (offset < buffer.length) {
    const lineEnd = buffer.indexOf("\r\n", offset);
    if (lineEnd === -1) break;
    const size = Number.parseInt(buffer.slice(offset, lineEnd).toString("utf8").split(";")[0], 16);
    if (!Number.isFinite(size) || size === 0) break;
    out.push(buffer.slice(lineEnd + 2, lineEnd + 2 + size));
    offset = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(out).toString("utf8");
}

function request(host, path, extra = "", target = path) {
  return new Promise((resolve, reject) => {
    const transport = edge ? tls : net;
    const options = edge ? { host, port: 443, servername: host } : { host: "127.0.0.1", port };
    const sock = transport.connect(options, () => {
      sock.write(`GET ${target} HTTP/1.1\r\nHost: ${host}\r\n${extra}Accept-Encoding: identity\r\nConnection: close\r\n\r\n`);
    });
    const chunks = [];
    sock.setTimeout(15000, () => {
      sock.destroy();
      reject(new Error(`timeout ${host} ${path}`));
    });
    sock.on("data", (chunk) => chunks.push(chunk));
    sock.on("error", reject);
    sock.on("end", () => {
      const buffer = Buffer.concat(chunks);
      const splitAt = buffer.indexOf("\r\n\r\n");
      const head = splitAt === -1 ? buffer.toString("utf8") : buffer.slice(0, splitAt).toString("utf8");
      const body = splitAt === -1 ? "" : decode(buffer.slice(splitAt + 4), head);
      resolve({
        status: Number(head.split(" ")[1]),
        location: head.match(/^location:\s*(.*)$/im)?.[1]?.trim() ?? "",
        head,
        body,
      });
    });
  });
}

function sessionCookie(response) {
  return response.head.split("\r\n").some((line) => /^set-cookie:\s*sb-/i.test(line) && !/max-age=0/i.test(line));
}

function same(left, right) {
  return left.status === right.status && left.body === right.body;
}

let failed = 0;
function report(index, label, ok, detail) {
  console.log(`${index} ${label} ${detail}${ok ? "" : " FALHOU"}`);
  if (!ok) failed += 1;
}

const ativoPage = await request(ativo, "/");
const trialPage = await request(trial, "/");
const neutral = await request(`naoexiste.${base}`, "/");
const otherNeutral = await request(`ausente.${base}`, "/");
const slugA = ativo.split(".")[0].toLowerCase();
const ownsA = ativoPage.status === 200 && ativoPage.body.toLowerCase().includes(slugA) && ativoPage.body !== trialPage.body;
if (!ownsA) {
  console.error(`host A não respondeu 200 com conteúdo próprio (status=${ativoPage.status})`);
  process.exit(1);
}

const swapped = await request(ativo, "/", `x-bc-host: ${trial}\r\n`);
report(1, "x-bc-host", same(swapped, ativoPage) && swapped.body !== trialPage.body, `status=${swapped.status}`);

const canSeal = /^[0-9a-f]{32}$/.test(nonce) && secret.length >= 32;
if (canSeal) {
  const trialSeal = seal(rewritePath, trial.toLowerCase());
  const replay = await request(ativo, rewritePath, `x-bc-host: ${trial}\r\nx-bc-seal: ${trialSeal}\r\n`);
  const sealOk = replay.status === 404 && replay.body === neutral.body && replay.body !== trialPage.body;
  report(2, "selo de /tenant/x no host B", sealOk, `status=${replay.status}`);
} else if (edge) {
  console.log("2 selo de /tenant/x no host B fora do --edge sem o nonce do processo");
} else {
  report(2, "selo de /tenant/x no host B", false, "sem nonce do processo");
}

report(
  3,
  "host inexistente",
  neutral.status === 404 && otherNeutral.status === 404 && neutral.body === otherNeutral.body && neutral.body.includes("Página não encontrada"),
  `status=${neutral.status}`,
);

const handoffPath = "/auth/handoff?c=0000000000000000000000000000000000000000000000000000000000000000";
const handoff = await request(ativo, handoffPath, `x-bc-host: ${trial}\r\n`);
const handoffRef = await request(ativo, handoffPath);
report(
  4,
  "handoff com x-bc-host",
  !sessionCookie(handoff) && handoff.status !== 200 && same(handoff, handoffRef),
  `status=${handoff.status}`,
);

const duplicated = await request(ativo, "/", `x-bc-host: ${trial}\r\nx-bc-host: outro.${base}\r\n`);
report(5, "x-bc-host duplicado", same(duplicated, ativoPage) && duplicated.body !== trialPage.body, `status=${duplicated.status}`);

const variants = [
  `x-bc-host: ${trialLabel.toUpperCase()}.${base}\r\n`,
  `x-bc-host: ${trial}:443\r\n`,
  `x-bc-host:  ${trial} \r\n`,
];
const varied = [];
for (const extra of variants) varied.push(await request(ativo, "/", extra));
report(
  6,
  "maiuscula porta espaco",
  varied.every((item) => same(item, ativoPage) && item.body !== trialPage.body),
  varied.map((item) => item.status).join(","),
);

const forwarded = await request(ativo, "/", `X-Forwarded-Host: ${trial}\r\n`);
report(7, "X-Forwarded-Host", same(forwarded, ativoPage) && forwarded.body !== trialPage.body, `status=${forwarded.status}`);

if (!edge) {
  const absolute = await request(ativo, "/", "", `http://${trial}/`);
  const absoluteOk = (same(absolute, ativoPage) || (absolute.status === 404 && absolute.body === neutral.body)) && !absolute.body.includes("<h1>Trial");
  report(8, "request-line absoluta", absoluteOk, `status=${absolute.status} location=${absolute.location || "-"}`);
}

const total = edge ? (canSeal ? 7 : 6) : 8;
if (failed) {
  console.error(`forja=${total - failed}/${total}`);
  process.exit(1);
}
console.log(`forja=${total}/${total}`);
