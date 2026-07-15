// Proxy serverless entre a página estática e a API do Metam.
// Faz login server-side (credenciais em variáveis de ambiente), guarda o token
// em memória entre invocações e repassa apenas os dados de leitura.
// Nenhuma credencial trafega para o navegador.

const BASE = "https://backend.metam.com.br/api";

// Cache em escopo de módulo: sobrevive entre invocações enquanto a função
// permanecer "quente" na Netlify.
let cache = { token: null, refresh: null, exp: 0 };

function decodeExp(jwt) {
  try {
    const payload = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64").toString("utf8")
    );
    return (payload.exp || 0) * 1000;
  } catch {
    // Sem exp legível: assume validade curta para forçar renovação.
    return Date.now() + 5 * 60 * 1000;
  }
}

async function login() {
  const email = process.env.METAM_EMAIL;
  const password = process.env.METAM_PASSWORD;
  if (!email || !password) {
    throw new Error(
      "Credenciais Metam ausentes. Configure METAM_EMAIL e METAM_PASSWORD nas variáveis de ambiente da Netlify."
    );
  }
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) {
    throw new Error(`Login no Metam falhou (HTTP ${r.status}).`);
  }
  const d = await r.json();
  cache.token = d.access_token;
  cache.refresh = d.refresh_token;
  cache.exp = decodeExp(d.access_token);
  return cache.token;
}

async function refresh() {
  if (!cache.refresh) return login();
  const r = await fetch(`${BASE}/auth/refresh-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: cache.refresh }),
  });
  if (!r.ok) return login();
  const d = await r.json();
  cache.token = d.access_token;
  cache.refresh = d.refresh_token;
  cache.exp = decodeExp(d.access_token);
  return cache.token;
}

async function getToken() {
  // 30s de folga para não usar um token prestes a expirar.
  if (cache.token && Date.now() < cache.exp - 30_000) return cache.token;
  if (cache.refresh) return refresh();
  return login();
}

async function api(path) {
  let token = await getToken();
  let r = await fetch(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // Token pode ter sido invalidado do lado do Metam: renova uma vez e repete.
  if (r.status === 401) {
    cache.token = null;
    token = await getToken();
    r = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`Metam ${path} → HTTP ${r.status} ${body.slice(0, 200)}`);
  }
  return r.json();
}

export async function handler(event) {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };

  try {
    const q = event.queryStringParameters || {};
    const action = q.action || "reading";

    // Allowlist de dispositivos que a página pode consultar. Evita que a função
    // pública seja usada para enumerar/ler qualquer locationId da conta.
    const allowed = (process.env.METAM_LOCATION_IDS || "71987,71961")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const defaultId = process.env.METAM_LOCATION_ID || allowed[0] || "71987";
    const requested = q.locationId || defaultId;
    const locationId = allowed.includes(String(requested)) ? String(requested) : null;
    if (!locationId) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: `locationId não permitido: ${requested}` }),
      };
    }
    const equipmentId = locationId;
    const supervisoryId = process.env.METAM_SUPERVISORY_ID || "1940";

    let data;
    switch (action) {
      case "reading": // leitura atual (a tela "Medição de Água")
        data = await api(`/last-report/${locationId}`);
        break;
      case "fields": // definição/metadados dos campos do device
        data = await api(`/last-report/fields/${locationId}`);
        break;
      case "history": // série histórica para os gráficos
        data = await api(`/equipment/${equipmentId}/history`);
        break;
      case "supervisory": // config do dashboard (widgets)
        data = await api(`/supervisory/${supervisoryId}`);
        break;
      case "widget": // valor atual de um widget do supervisório
        data = await api(`/supervisory/${supervisoryId}/widget/${q.widgetId}`);
        break;
      case "all": // conveniência para inspeção: leitura + campos juntos
        {
          const [reading, fields] = await Promise.all([
            api(`/last-report/${locationId}`).catch((e) => ({ error: String(e.message || e) })),
            api(`/last-report/fields/${locationId}`).catch((e) => ({ error: String(e.message || e) })),
          ]);
          data = { reading, fields };
        }
        break;
      default:
        throw new Error(`Ação desconhecida: ${action}`);
    }

    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: String(e.message || e) }),
    };
  }
}
