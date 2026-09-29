/**
 * Capture collector: tiny HTTP sink for the browser capture harness
 * (tools/capture). The harness POSTs PNG/GIF blobs here and they land in
 * docs/media/. Run: node tools/capture/collect.mjs
 */
import { createServer } from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = resolve(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "media"));
await mkdir(outDir, { recursive: true });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (url.pathname === "/ping") {
    res.writeHead(200, { "content-type": "text/plain", ...CORS });
    res.end("ok");
    return;
  }
  if (req.method === "POST" && url.pathname === "/save") {
    const name = url.searchParams.get("name") ?? "";
    if (!/^[\w.-]+$/.test(name)) {
      res.writeHead(400, CORS);
      res.end("bad name");
      return;
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks);
    await writeFile(join(outDir, name), body);
    console.log(`saved ${name} (${(body.length / 1024).toFixed(0)} kB)`);
    res.writeHead(200, { "content-type": "application/json", ...CORS });
    res.end(JSON.stringify({ ok: true, name, bytes: body.length }));
    return;
  }
  res.writeHead(404, CORS);
  res.end();
});

server.listen(31339, () => console.log(`collector on :31339 -> ${outDir}`));
