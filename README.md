# Radar de Mercado — Feed de Notícias (Widi Care)

Página que reúne **automaticamente todo dia às 05:00 (BRT)** as matérias mais recentes do nosso mercado, com link direto para cada uma. Cobre: E-commerce & Varejo, Beleza & Capilar, Investimento & Mercado, Logística, Concorrentes (lançamentos) e Marketing & Venda Digital.

Mesmo padrão dos outros dashboards: **HTML estático + GitHub Actions (cron) que gera `dados/feed.json` e o Vercel redeploya sozinho**.

## Como funciona
1. `scripts/gerar-feed.mjs` puxa os links via **RSS direto** dos portais + **Google News RSS** (busca por tema/concorrente). Sem dependências externas — usa o `fetch` nativo do Node 20+.
2. O script grava `dados/feed.json` (agrupado por categoria, ordenado por mais recente).
3. `index.html` lê esse JSON e monta a página (busca + filtro por categoria).
4. O GitHub Actions roda no cron `0 8 * * *` (08:00 UTC = 05:00 BRT), commita o `dados/` e o Vercel publica.

## Rodar / testar local
```bash
node scripts/gerar-feed.mjs
```
Depois abra o `index.html` por um servidor estático (o `fetch` do JSON não funciona via `file://`). Ex.: `npx serve` ou a extensão Live Server.

## Editar as fontes
Tudo fica no array `CATEGORIAS` no topo de `scripts/gerar-feed.mjs`. Cada fonte é:
- `{ tipo: 'rss', url: '…' }` — feed RSS/Atom direto de um portal.
- `{ tipo: 'gnews', query: '…' }` — busca no Google News (aceita `site:` e `when:7d`); use `lang: 'en'` para fontes globais.

Para acompanhar um novo concorrente, é só acrescentar o nome na `query` da categoria **Concorrentes**.

## Deploy (uma vez só)
Igual ao `dashboard-vendas` / `dashboard-estoque`:

1. **Criar o repositório no GitHub** (ex.: `widi-feed-noticias`) e subir esta pasta:
   ```bash
   git init && git add . && git commit -m "feat: radar de mercado"
   git branch -M main
   git remote add origin https://github.com/<seu-usuario>/widi-feed-noticias.git
   git push -u origin main
   ```
2. **Conectar no Vercel:** New Project → importar o repositório → framework **Other** → deploy. Não precisa de variável de ambiente nem build (é estático).
3. **Ligar o cron:** o workflow `.github/workflows/atualizar-feed.yml` já roda sozinho às 5h. Para testar na hora: aba **Actions → Atualizar feed de notícias → Run workflow**.
4. Pronto: cada execução commita o `feed.json` e o Vercel redeploya automático.

> Sem segredos/tokens: todas as fontes são feeds públicos. Se algum portal mudar a URL do feed, o script apenas ignora aquela fonte (não quebra) e o rodapé da página mostra quantas fontes ficaram sem retorno.
