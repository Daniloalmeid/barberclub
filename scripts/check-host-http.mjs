import net from "node:net";

const port = Number(process.argv[2] ?? 3456);
const B = "barber.workloop.com.br";

function raw(path, host, extra = "", method = "GET") {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      const hostLine = host == null ? "" : `Host: ${host}\r\n`;
      const version = host == null ? "HTTP/1.0" : "HTTP/1.1";
      sock.write(`${method} ${path} ${version}\r\n${hostLine}${extra}Connection: close\r\n\r\n`);
    });
    const chunks = [];
    sock.setTimeout(8000, () => {
      sock.destroy();
      reject(new Error(`timeout ${path}`));
    });
    sock.on("data", (chunk) => chunks.push(chunk));
    sock.on("error", reject);
    sock.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const splitAt = text.indexOf("\r\n\r\n");
      const head = splitAt === -1 ? text : text.slice(0, splitAt);
      const body = splitAt === -1 ? "" : text.slice(splitAt + 4);
      const status = Number(head.split(" ")[1]);
      const location = head.match(/^location:\s*(.*)$/im)?.[1]?.trim() ?? "";
      resolve({ status, location, head, body });
    });
  });
}

const cases = [
  { host: B, path: "/", status: 200, includes: "<h1>BarberClub</h1>" },
  { host: `ativo.${B}`, path: "/", status: 200, includes: "<h1>Ativo</h1>" },
  { host: `trial1.${B}`, path: "/", status: 200, includes: "Trial" },
  { host: `naoexiste.${B}`, path: "/", status: 404, includes: "Página não encontrada" },
  { host: `suspenso.${B}`, path: "/", status: 404, includes: "Página não encontrada" },
  { host: `api.${B}`, path: "/", status: 404, includes: "Página não encontrada" },
  { host: `app.${B}`, path: "/", status: 404 },
  { host: `a.b.${B}`, path: "/", status: 404 },
  { host: `www.${B}`, path: "/", status: 308, location: `https://${B}/` },
  { host: `www.${B}`, path: "/termos/", status: 308, location: `https://${B}/termos` },
  { host: "a b." + B, path: "/", status: 400 },
  { host: `${B}:70000`, path: "/", status: 400 },
  { host: null, path: "/", status: 400 },
  { host: B, path: "/foo/%252e%252e/bar", status: 400 },
  { host: B, path: "/login/regularizar", status: 303, location: `https://${B}/login` },
  { host: B, path: "/login/regularizar/", status: 308, location: `https://${B}/login/regularizar` },
  { host: `ativo.${B}`, path: "/login/regularizar", status: 404 },
  { host: B, path: "/contato", status: 404 },
  { host: B, path: "/recuperar", status: 404 },
  { host: "127.0.0.1", path: "/api/health/live", status: 200 },
];

let failed = 0;
for (const item of cases) {
  const response = await raw(item.path, item.host);
  const problems = [];
  if (response.status !== item.status) problems.push(`status ${response.status}`);
  if (item.location !== undefined && response.location !== item.location) problems.push(`location ${response.location}`);
  if (item.includes && !response.body.includes(item.includes)) problems.push("corpo");
  if (response.status === 404 && (response.body.includes("inativo") || response.body.includes("suspenso"))) {
    problems.push("404 vazou estado");
  }
  if (leaksInternal(response)) problems.push("vazou header interno");
  const label = `${item.host ?? "(sem host)"} ${item.path}`;
  if (problems.length) {
    failed += 1;
    console.error(`${label}: ${problems.join("; ")}`);
  } else {
    console.log(`${label} ${response.status}${response.location ? ` ${response.location}` : ""}`);
  }
}

function leaksInternal(response) {
  return /x-bc-|x-middleware-request-/i.test(response.head);
}

function signature(response) {
  const headers = response.head
    .split("\r\n")
    .slice(1)
    .map((line) => line.trim())
    .filter((line) => line && !/^date:/i.test(line))
    // A CSP carrega um nonce por requisição, e é isso que impede a página de sair em
    // branco: o Next precisa do nonce para executar o bootstrap inline. Um nonce que
    // se repete deixaria de ser nonce. Então aqui a comparação do 404 neutro é feita
    // em tudo, menos nesse header — o resto tem de ser byte a byte igual entre hosts.
    .filter((line) => !/^content-security-policy:/i.test(line))
    .map((line) => line.toLowerCase())
    .sort();
  return `${response.status}\n${headers.join("\n")}\n${response.body}`;
}

const neutralHosts = [
  `naoexiste.${B}`,
  `suspenso.${B}`,
  `api.${B}`,
  `app.${B}`,
  `admin.${B}`,
  `ab.${B}`,
  `xn--abc.${B}`,
  `a.b.${B}`,
  "[::1]",
  "evil.com",
];
const neutral = [];
for (const host of neutralHosts) {
  neutral.push({ host, response: await raw("/", host) });
}
const baseline = signature(neutral[0].response);
for (const item of neutral) {
  if (signature(item.response) !== baseline) {
    failed += 1;
    console.error(`404 de ${item.host} difere de ${neutralHosts[0]}`);
  } else {
    console.log(`404 ${item.host} = ${neutralHosts[0]}`);
  }
}

const matrix = [
  { path: "/foo/%252e%252e/bar", status: 400 },
  { path: "/foo/%252fbar", status: 400 },
  { path: "/foo/%5c", status: 400 },
  { path: "/foo/%2fbar", status: 400 },
  { path: "/..;x/", status: 400 },
  { path: "/..;x", status: 400 },
  { path: "/a;b", status: 400 },
  { path: "/foo/", status: 308, location: `https://ativo.${B}/foo` },
  { path: "/foo/?a=1", status: 308, location: `https://ativo.${B}/foo?a=1` },
  { path: "/api/health/", status: 308, location: `https://ativo.${B}/api/health` },
  { path: "//evil.com/", status: 308, location: "/evil.com/" },
  { path: "/foo/%2e%2e/bar", status: 404 },
  { path: "/foo/../bar", status: 404 },
  { path: "/", status: 200 },
  { path: "/api/health/live", status: 200 },
];
for (const item of matrix) {
  const response = await raw(item.path, `ativo.${B}`);
  const problems = [];
  if (response.status !== item.status) problems.push(`status ${response.status}`);
  if (item.location !== undefined && response.location !== item.location) problems.push(`location ${response.location}`);
  if (response.location.startsWith("//") || (response.location.includes("://") && !response.location.startsWith(`https://ativo.${B}/`))) {
    problems.push(`location externo ${response.location}`);
  }
  if (leaksInternal(response)) problems.push("vazou header interno");
  if (problems.length) {
    failed += 1;
    console.error(`ativo ${item.path}: ${problems.join("; ")}`);
  } else {
    console.log(`ativo ${item.path} ${response.status}`);
  }
}

const swapped = await raw("/", `ativo.${B}`, `x-bc-host: trial1.${B}\r\n`);
if (swapped.status !== 200 || !swapped.body.includes("<h1>Ativo</h1>") || swapped.body.includes("<h1>Trial") || swapped.body.includes("Trial Um")) {
  failed += 1;
  console.error(`x-bc-host do cliente: status ${swapped.status} body ${swapped.body.slice(0, 180)}`);
} else {
  console.log("x-bc-host do cliente nao troca o tenant");
}
const liveMarked = await raw("/api/health/live", `ativo.${B}`, `x-bc-host: trial1.${B}\r\n`);
if (liveMarked.status !== 200 || !liveMarked.body.includes('"status":"ok"')) {
  failed += 1;
  console.error(`x-bc-host em /api/health/live: status ${liveMarked.status} body ${liveMarked.body.slice(0, 120)}`);
} else {
  console.log("x-bc-host forjado nao chega em /api/health/live");
}
const internalMarked = await raw("/api/internal/revalidate", `ativo.${B}`, `x-bc-host: trial1.${B}\r\n`, "POST");
if (internalMarked.status !== 404 || signature(internalMarked) !== baseline || internalMarked.body.includes("Trial")) {
  failed += 1;
  console.error(`x-bc-host em /api/internal: status ${internalMarked.status} body ${internalMarked.body.slice(0, 180)}`);
} else {
  console.log("x-bc-host em /api/internal serve o 404 do ativo");
}
const cronMarked = await raw("/api/cron/handoffs", `ativo.${B}`, `x-bc-host: ${B}\r\n`, "POST");
if (cronMarked.status !== 404) {
  failed += 1;
  console.error(`x-bc-host em /api/cron: status ${cronMarked.status}`);
} else {
  console.log("x-bc-host forjado nao torna /api/cron o host base");
}

const forged = await raw("/tenant/trial1", `ativo.${B}`, "x-bc-route: tenant:trial1\r\nx-bc-seal: forjado\r\n");
const forgedAtivo = await raw("/tenant/ativo", `ativo.${B}`, "x-bc-route: tenant:ativo\r\n");
if (forged.status !== 404 || signature(forged) !== baseline || forged.body.includes("<h1>Trial</h1>") || forged.body.includes("<h1>Ativo</h1>")) {
  failed += 1;
  console.error(`header forjado: status ${forged.status} location ${forged.location} body ${forged.body.slice(0, 180)}`);
} else {
  console.log("header forjado 404 neutro");
}
if (forgedAtivo.status !== 404 || signature(forgedAtivo) !== baseline || forgedAtivo.body.includes("<h1>Ativo</h1>")) {
  failed += 1;
  console.error(`tenant/ativo forjado: status ${forgedAtivo.status}`);
} else {
  console.log("GET /tenant/ativo com x-bc-route forjado 404 neutro");
}

if (failed) process.exit(1);
