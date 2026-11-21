import net from "node:net";

const port = Number(process.argv[2] ?? 3456);
const B = "barber.workloop.com.br";

function raw(path, host) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      const hostLine = host == null ? "" : `Host: ${host}\r\n`;
      const version = host == null ? "HTTP/1.0" : "HTTP/1.1";
      sock.write(`GET ${path} ${version}\r\n${hostLine}Connection: close\r\n\r\n`);
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
  { host: B, path: "/login/regularizar", status: 303, location: "/login" },
  { host: B, path: "/login/regularizar/", status: 308, location: "/login/regularizar" },
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
  const label = `${item.host ?? "(sem host)"} ${item.path}`;
  if (problems.length) {
    failed += 1;
    console.error(`${label}: ${problems.join("; ")}`);
  } else {
    console.log(`${label} ${response.status}${response.location ? ` ${response.location}` : ""}`);
  }
}

const missing = await raw("/", `naoexiste.${B}`);
const suspended = await raw("/", `suspenso.${B}`);
if (missing.body !== suspended.body) {
  failed += 1;
  console.error("404 de inexistente e suspenso diferem");
} else {
  console.log("404 inexistente = suspenso");
}

if (failed) process.exit(1);
