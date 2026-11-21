import net from "node:net";
import tls from "node:tls";

const edge = process.argv.includes("--edge");
const port = Number(process.argv.find((arg) => /^\d+$/.test(arg)) ?? 3471);
const B = "barber.workloop.com.br";
const ativo = `ativo.${B}`;
const trial = `trial1.${B}`;

function request(host, path, extra = "", method = "GET") {
  return new Promise((resolve, reject) => {
    const transport = edge ? tls : net;
    const options = edge ? { host, port: 443, servername: host } : { host: "127.0.0.1", port };
    const sock = transport.connect(options, () => {
      const hostLine = edge ? `Host: ${host}\r\n` : `Host: ${host}\r\n`;
      sock.write(`${method} ${path} HTTP/1.1\r\n${hostLine}${extra}Connection: close\r\n\r\n`);
    });
    const chunks = [];
    sock.setTimeout(15000, () => {
      sock.destroy();
      reject(new Error(`timeout ${host} ${path}`));
    });
    sock.on("data", (chunk) => chunks.push(chunk));
    sock.on("error", reject);
    sock.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const splitAt = text.indexOf("\r\n\r\n");
      const head = splitAt === -1 ? text : text.slice(0, splitAt);
      const body = splitAt === -1 ? "" : text.slice(splitAt + 4);
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

let seal = "";
if (!edge) {
  const minted = await request(trial, "/__bc/probe?path=/tenant/trial1");
  seal = minted.head.match(/^x-probe-seal:\s*(.*)$/im)?.[1]?.trim() ?? "";
}
const portable = await request(ativo, "/", `x-bc-route: tenant:trial1\r\nx-bc-seal: ${seal || "forjado"}\r\n`);
report(
  2,
  "selo portatil",
  same(portable, ativoPage) && portable.body !== trialPage.body,
  `status=${portable.status}`,
);

report(
  3,
  "host inexistente",
  neutral.status === 404 && otherNeutral.status === 404 && neutral.body === otherNeutral.body && neutral.body.includes("Página não encontrada"),
  `status=${neutral.status}`,
);

const handoff = await request(ativo, "/auth/handoff?c=0000000000000000000000000000000000000000000000000000000000000000");
const handoffAgain = await request(ativo, "/auth/handoff?c=0000000000000000000000000000000000000000000000000000000000000000");
report(
  4,
  "handoff invalido",
  !sessionCookie(handoff) && handoff.status !== 200 && same(handoff, handoffAgain),
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

if (failed) {
  console.error(`forja=${7 - failed}/7`);
  process.exit(1);
}
console.log("forja=7/7");
