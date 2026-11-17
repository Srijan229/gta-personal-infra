import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { source, config } from "./core.mjs";
import { startGateway } from "./gateway.mjs";

const role = process.argv[2];
// Force the upstream Express listener onto loopback for this local-only profile.
if (role === "backend") {
  const listen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    if (typeof args[0] === "number" || /^\d+$/.test(String(args[0]))) {
      const callback = args.find((arg) => typeof arg === "function");
      return listen.call(
        this,
        { port: Number(args[0]), host: config.bindAddress },
        ...(callback ? [callback] : []),
      );
    }
    return listen.apply(this, args);
  };
  process.chdir(path.join(source, "backend"));
  createRequire(import.meta.url)(
    path.join(source, "backend", "src", "server.js"),
  );
} else if (role === "gateway") startGateway();
else throw Error("Unknown worker role");
