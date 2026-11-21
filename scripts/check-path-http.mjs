import net from "node:net";

const port = Number(process.argv[2] ?? process.env.PATH_HTTP_PORT ?? 3456);
const hostHeader = "slug.barber.workloop.com.br";

function raw(path) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, "127.0.0.1", () => {
      sock.write(`GET ${path} HTTP/1.1\r\nHost: ${hostHeader}\r\nConnection: close\r\n\r\n`);
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
      const cache = head.match(/^cache-control:\s*(.*)$/im)?.[1]?.trim() ?? "";
      resolve({ status, location, cache, body });
    });
  });
}

function assertNoLeak(path, body) {
  const forbidden = ["/etc/passwd", "EACCES", "Error: ENOENT", "root:x:"];
  for (const piece of forbidden) {
    if (body.includes(piece)) {
      throw new Error(`${path} vazou ${piece}`);
    }
  }
}

const cases = [
  { path: "/foo/%252e%252e/bar", status: 400, location: "" },
  { path: "/foo/%252fbar", status: 400, location: "" },
  { path: "/foo/%5c", status: 400, location: "" },
  { path: "/foo/%2fbar", status: 400, location: "" },
  { path: "/..;x/", status: 400, location: "" },
  { path: "/..;x", status: 400, location: "" },
  { path: "/a;b", status: 400, location: "" },
  { path: "/foo/", status: 308, location: "/foo" },
  { path: "/foo/?a=1", status: 308, location: "/foo?a=1" },
  { path: "/api/health/", status: 308, location: "/api/health" },
  { path: "/", status: 200, location: "" },
  { path: "//evil.com/", status: 308, location: "/evil.com/" },
  { path: "/foo/%2e%2e/bar", status: 404, location: "" },
  { path: "/foo/../bar", status: 404, location: "" },
  { path: "/api/health/live", status: 200, location: "" },
];

let failed = 0;
for (const item of cases) {
  const response = await raw(item.path);
  const problems = [];
  if (response.status !== item.status) {
    problems.push(`status ${response.status} esperado ${item.status}`);
  }
  if (response.location !== item.location) {
    problems.push(`location ${response.location || "(vazio)"} esperado ${item.location || "(vazio)"}`);
  }
  if (response.location.startsWith("//") || response.location.includes("://")) {
    problems.push(`location externo ${response.location}`);
  }
  assertNoLeak(item.path, response.body);
  if (item.status === 400) {
    if (!response.body.includes('"error":"bad_path"') && !response.body.includes('"error": "bad_path"')) {
      problems.push(`corpo sem bad_path: ${response.body.slice(0, 120)}`);
    }
    if (!response.cache.toLowerCase().includes("no-store")) {
      problems.push(`cache-control ${response.cache || "(vazio)"}`);
    }
  }
  if (item.status === 404 && !response.body.includes("<!DOCTYPE html")) {
    problems.push("404 sem a página do app");
  }
  if (problems.length) {
    failed += 1;
    console.error(`${item.path}: ${problems.join("; ")}`);
  } else {
    console.log(`${item.path} ${response.status}${response.location ? ` ${response.location}` : ""}`);
  }
}

if (failed) {
  process.exit(1);
}
