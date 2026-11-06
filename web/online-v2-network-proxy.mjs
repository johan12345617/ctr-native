// Test-only TCP delay proxy. Timing runs outside the browser's simulation thread
// so a long rendered frame does not artificially delay its outgoing send timer.
import { createServer, connect } from "node:net";

export async function createNetworkProxy({ targetPort, inputDelayMs = 0, frameDelayMs = 0, jitterMs = 0 }) {
  const connections = new Set();
  const cleanups = new Set();
  function pipe(source, destination, delay) {
    const queue = [];
    let timer, bytes = 0, count = 0, ended = false, waiting = false, stopped = false;
    const cleanup = () => { stopped = true; clearTimeout(timer); queue.length = 0; };
    cleanups.add(cleanup);
    function pump() {
      if (stopped || waiting || timer) return;
      if (!queue.length) { if (ended && !destination.destroyed) destination.end(); return; }
      const remaining = queue[0].at - performance.now();
      if (remaining > 0) {
        timer = setTimeout(() => { timer = undefined; pump(); }, remaining); return;
      }
      while (queue.length && queue[0].at <= performance.now()) {
        const entry = queue.shift(); bytes -= entry.chunk.length;
        if (destination.destroyed) { cleanup(); return; }
        if (!destination.write(entry.chunk)) {
          waiting = true;
          destination.once("drain", () => { waiting = false; pump(); }); break;
        }
      }
      if (bytes < 1024 * 1024) source.resume();
      if (!waiting) pump();
    }
    source.on("data", chunk => {
      const noise = jitterMs ? (++count % 3 - 1) * jitterMs : 0;
      queue.push({ chunk, at: performance.now() + Math.max(0, delay + noise) });
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) source.pause();
      pump();
    });
    source.on("end", () => { ended = true; pump(); });
    destination.on("close", () => { cleanup(); cleanups.delete(cleanup); });
  }
  const server = createServer(client => {
    const upstream = connect({ port: targetPort, host: "127.0.0.1" });
    connections.add(client); connections.add(upstream);
    const stop = () => { client.destroy(); upstream.destroy(); connections.delete(client); connections.delete(upstream); };
    client.on("error", stop); upstream.on("error", stop);
    client.on("close", stop); upstream.on("close", stop);
    pipe(client, upstream, inputDelayMs); pipe(upstream, client, frameDelayMs);
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return {
    port: server.address().port,
    close: () => new Promise(resolve => {
      for (const cleanup of cleanups) cleanup(); cleanups.clear();
      for (const socket of connections) socket.destroy();
      server.close(resolve);
    }),
  };
}
