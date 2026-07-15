# Supervisório LifeSense (Metam)

Página web de supervisório que lê a telemetria da plataforma **Metam** e exibe
os cards (Consumo, Vazão, etc.) com atualização automática. Publicável na
**Netlify**. A leitura passa por uma **função serverless** que faz login no
Metam do lado do servidor — as credenciais **nunca** vão para o navegador.

```
metam-supervisorio/
├─ public/                 # front-end estático (o que fica público)
│  ├─ index.html
│  ├─ styles.css
│  └─ app.js
├─ netlify/functions/
│  └─ metam.js             # proxy: login + leitura da API do Metam
├─ netlify.toml            # config de build/redirect
└─ .env.example            # modelo das variáveis de ambiente
```

## Como funciona

```
Navegador ──> /api/metam?action=reading ──> função Netlify ──> backend.metam.com.br/api
   (público)        (mesma origem, sem CORS)     (login JWT + Bearer, server-side)
```

A API do Metam exige token JWT e **bloqueia CORS** de outras origens, por isso a
chamada direta do navegador não funciona — daí a função intermediária.

### Endpoints da função

| Chamada | O que retorna |
|---|---|
| `/api/metam?action=reading` | leitura atual (`/last-report/{locationId}`) |
| `/api/metam?action=fields` | metadados dos campos |
| `/api/metam?action=history` | série histórica (para o gráfico) |
| `/api/metam?action=supervisory` | config do dashboard (widgets) |
| `/api/metam?action=all` | leitura + campos juntos (inspeção) |

## Configuração (variáveis de ambiente)

Defina em **Netlify → Site settings → Environment variables** (e num `.env`
local para testes). Veja `.env.example`.

| Variável | Descrição |
|---|---|
| `METAM_EMAIL` | e-mail de uma conta de serviço do Metam (recomendo um usuário só-leitura dedicado) |
| `METAM_PASSWORD` | senha dessa conta |
| `METAM_LOCATION_ID` | ID da localização/leitura — padrão `71987` |
| `METAM_EQUIPMENT_ID` | ID do equipamento (histórico) — padrão `71987` |
| `METAM_SUPERVISORY_ID` | ID do dashboard — padrão `1940` |

> ⚠️ Não coloque a senha no código nem versione o `.env`. O `.gitignore` já
> protege o `.env`.

## Rodar localmente

```bash
npm install
# crie um .env a partir do .env.example e preencha as credenciais
npm run dev        # netlify dev — sobe front + função em http://localhost:8888
```

## Deploy na Netlify

1. Suba a pasta `metam-supervisorio/` para um repositório (GitHub/GitLab) **ou**
   arraste a pasta em app.netlify.com → *Add new site → Deploy manually*.
2. Em **Site settings → Environment variables**, cadastre as variáveis acima.
3. Build settings (se via Git): publish `public`, functions `netlify/functions`
   (já vêm do `netlify.toml`).
4. Deploy. A página fica em `https://<seu-site>.netlify.app`.

## Ajuste de campos (primeiro deploy)

O front-end **normaliza automaticamente** o formato da resposta, mas o shape
exato do `/last-report` do Metam só é visível com credenciais reais. No primeiro
acesso, abra:

```
https://<seu-site>.netlify.app/?debug=1
```

O painel de debug mostra o JSON bruto. Com esse JSON em mãos, dá pra afinar
rótulos/unidades/ordem dos cards em `public/app.js` (função `normalize`).

---

## Alternativa imediata: link público nativo do Metam

O Metam já tem recurso de **link público** de supervisório (sem código). Passo a
passo, logado em `metric.metam.com.br`:

1. Abra o supervisório (dashboard **1940**).
2. Procure a opção de **compartilhar / gerar link público** (ícone de
   compartilhamento ou engrenagem do supervisório).
3. Gere o link (defina um **PIN** se quiser proteger).
4. Use a URL gerada — ela abre o dashboard sem login.

Testei o endpoint `GET /supervisory/public/1940` e ele responde, mas hoje volta
vazio (`{}`) porque o link ainda **não foi gerado**. Depois de gerar pela
interface, ele passa a servir os dados.

Diferença: o link nativo é a cara do Metam (sem marca Life e sem customização);
esta página é branded e sob seu controle.
