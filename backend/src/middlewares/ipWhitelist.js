import { env } from "../config/env.js";

const OFFLINE_PAGE = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Sistema Indisponível</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      color: #334155;
    }
    .card {
      background: #fff;
      border-radius: 12px;
      padding: 48px 40px;
      max-width: 420px;
      width: 90%;
      text-align: center;
      box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    }
    .icon { font-size: 56px; margin-bottom: 20px; }
    h1 { font-size: 22px; font-weight: 700; margin-bottom: 12px; color: #1e293b; }
    p { font-size: 15px; line-height: 1.6; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">🔒</div>
    <h1>Sistema Indisponível</h1>
    <p>Este sistema só pode ser acessado a partir da rede interna da empresa.</p>
  </div>
</body>
</html>`;

function parseAllowedIps(raw) {
  return String(raw || "")
    .split(",")
    .map((ip) => ip.trim())
    .filter(Boolean);
}

function normalizeIp(ip) {
  // Remove ::ffff: prefix from IPv4-mapped IPv6 addresses
  return ip ? ip.replace(/^::ffff:/, "") : ip;
}

export function ipWhitelist(req, res, next) {
  const allowedIps = parseAllowedIps(env.allowedIps);

  // If no IPs configured, allow all (fail-open during development)
  if (allowedIps.length === 0) {
    if (env.nodeEnv === "production") {
      console.warn("[SECURITY WARNING] ALLOWED_IPS not configured in production. All IPs are permitted.");
    }
    return next();
  }

  const clientIp = normalizeIp(req.ip);

  if (allowedIps.includes(clientIp)) {
    return next();
  }

  console.warn(`[IP_BLOCKED] ${clientIp} — ${req.method} ${req.path}`);

  // API requests get JSON; browser requests get the offline page
  if (req.path.startsWith("/api") || req.headers.accept?.includes("application/json")) {
    return res.status(503).json({ message: "Serviço indisponível." });
  }

  return res.status(503).send(OFFLINE_PAGE);
}