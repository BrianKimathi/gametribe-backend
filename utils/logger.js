const os = require("os");

function nowIso() {
  return new Date().toISOString();
}

function mask(obj) {
  if (!obj || typeof obj !== "object") return obj;
  const out = { ...obj };
  for (const k of Object.keys(out)) {
    const key = k.toLowerCase();
    if (key.includes("token") || key.includes("authorization") || key.includes("key")) {
      const v = String(out[k] || "");
      out[k] = v.length > 8 ? `${v.slice(0, 4)}...${v.slice(-4)}(len=${v.length})` : "<masked>";
    }
  }
  return out;
}

function createLogger(namespace = "app") {
  const host = os.hostname();
  const base = { ns: namespace, host };

  function fmt(level, message, meta) {
    const entry = {
      ts: nowIso(),
      level,
      msg: message,
      ...base,
      ...(meta ? { meta: mask(meta) } : {}),
    };
    return JSON.stringify(entry);
  }

  return {
    debug: (m, meta) => console.log(fmt("DEBUG", m, meta)),
    info: (m, meta) => console.log(fmt("INFO", m, meta)),
    warn: (m, meta) => console.warn(fmt("WARN", m, meta)),
    error: (m, meta) => console.error(fmt("ERROR", m, meta)),
    time: () => Date.now(),
    endTimer: (started) => Date.now() - started,
  };
}

module.exports = { createLogger };



