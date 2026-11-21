import { createHmac } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

const edge = process.argv.includes("--edge");
const port = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 3471);
const B = "barber.workloop.com.br";
const ativo = `ativo.${B}`;
const trial = `trial1.${B}`;
const rewritePath = "/tenant/x";
const nonce = process.env.BC_ROUTE_NONCE ?? "";
const secret = process.env.BC_ROUTE_SECRET ?? "";

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
const neutral = await request(`naoexiste.${B}`, "/");
const otherNeutral = await request(`ausente.${B}`, "/");

const swapped = await request(ativo, "/", `x-bc-host: ${trial}\r\n`);
report(1, "x-bc-host", same(swapped, ativoPage) && !swapped.body.includes("<h1>Trial"), `status=${swapped.status}`);

const ativoSeal = edge ? "" : seal(rewritePath, ativo);
const reentryExtra = `x-bc-host: ${trial}\r\nx-bc-seal: ${ativoSeal || "ab".repeat(32)}\r\n`;
let reentryOk = false;
let reentryDetail = "";
if (edge) {
  const replay = await request(ativo, rewritePath, reentryExtra);
  reentryOk = replay.status === 404 && !replay.body.includes("<h1>Trial");
  reentryDetail = `status=${replay.status}`;
} else {
  const control = await request(`127.0.0.1:${port}`, rewritePath, `x-bc-host: ${ativo}\r\nx-bc-seal: ${ativoSeal}\r\n`);
  const byIp = await request(`127.0.0.1:${port}`, rewritePath, reentryExtra);
  const byName = await request(`localhost:${port}`, rewritePath, reentryExtra);
  reentryOk =
    same(control, ativoPage) &&
    byIp.status === 404 &&
    byName.status === 404 &&
    byIp.body === neutral.body &&
    byName.body === neutral.body &&
    !byIp.body.includes("<h1>Trial") &&
    !byName.body.includes("<h1>Trial");
  reentryDetail = `controle=${control.status} ip=${byIp.status} local=${byName.status}`;
}
report(2, "reentrada", reentryOk, reentryDetail);

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

const duplicated = await request(ativo, "/", `x-bc-host: ${trial}\r\nx-bc-host: outro.${B}\r\n`);
report(5, "x-bc-host duplicado", same(duplicated, ativoPage), `status=${duplicated.status}`);

const variants = [
  `x-bc-host: TRIAL1.${B}\r\n`,
  `x-bc-host: ${trial}:443\r\n`,
  `x-bc-host:  ${trial} \r\n`,
];
const varied = [];
for (const extra of variants) varied.push(await request(ativo, "/", extra));
report(
  6,
  "maiuscula porta espaco",
  varied.every((item) => same(item, ativoPage)),
  varied.map((item) => item.status).join(","),
);

const forwarded = await request(ativo, "/", `X-Forwarded-Host: ${trial}\r\n`);
report(7, "X-Forwarded-Host", same(forwarded, ativoPage) && !forwarded.body.includes("<h1>Trial"), `status=${forwarded.status}`);

if (!edge) {
  const absolute = await request(ativo, "/", "", `http://${trial}/`);
  const absoluteOk = (same(absolute, ativoPage) || (absolute.status === 404 && absolute.body === neutral.body)) && !absolute.body.includes("<h1>Trial");
  report(8, "request-line absoluta", absoluteOk, `status=${absolute.status} location=${absolute.location || "-"}`);
}

if (failed) {
  console.error(`forja=${(edge ? 7 : 8) - failed}/${edge ? 7 : 8}`);
  process.exit(1);
}
console.log(`forja=${edge ? 7 : 8}/${edge ? 7 : 8}`);
