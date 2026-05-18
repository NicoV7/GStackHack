import http from "node:http";

const listenPort = Number(process.env.PORT || 4100);
const backendPort = Number(process.env.GBRAIN_BACKEND_PORT || 4101);
const sharedSecret = process.env.GBRAIN_SHARED_SECRET?.trim();

if (!sharedSecret) {
  console.error("GBRAIN_SHARED_SECRET is required for the GBrain auth proxy.");
  process.exit(1);
}

const backendOrigin = `http://127.0.0.1:${backendPort}`;

const server = http.createServer(async (req, res) => {
  const expected = `Bearer ${sharedSecret}`;
  if (req.headers.authorization !== expected) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined;
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (!value || name.toLowerCase() === "host" || name.toLowerCase() === "authorization") continue;
      headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }

    const upstream = await fetch(new URL(req.url || "/", backendOrigin), {
      method: req.method,
      headers,
      body,
      duplex: "half",
    });

    res.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
    if (upstream.body) {
      for await (const chunk of upstream.body) res.write(chunk);
    }
    res.end();
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "bad_gateway", detail: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`GBrain auth proxy listening on ${listenPort}, forwarding to ${backendOrigin}`);
});
