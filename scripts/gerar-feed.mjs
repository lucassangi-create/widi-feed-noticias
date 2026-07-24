// gerar-feed.mjs — Agregador de notícias de mercado (Widi Care)
// Puxa os links das matérias mais recentes de cada fonte (RSS direto + Google News RSS)
// e grava dados/feed.json. Sem dependências externas: usa fetch global do Node 20+.
//
// Rodar local:  node scripts/gerar-feed.mjs
// No CI roda diariamente às 05:00 BRT (08:00 UTC) via GitHub Actions.

import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAIZ = join(__dirname, '..');

// ── Config ────────────────────────────────────────────────────────────────
const POR_FONTE = 6;        // máx. de matérias por fonte
const POR_CATEGORIA = 16;   // máx. de matérias por categoria (após juntar as fontes)
const TIMEOUT_MS = 15000;

// Helper: monta URL de busca do Google News RSS. when:7d = últimos 7 dias.
// lang 'en' usa parâmetros em inglês (para fontes globais); padrão é pt-BR.
const gnews = (q, lang) => {
  const params = lang === 'en' ? 'hl=en-US&gl=US&ceid=US:en' : 'hl=pt-BR&gl=BR&ceid=BR:pt-419';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${params}`;
};

// Categorias e fontes. tipo: 'rss' (feed direto) | 'gnews' (busca Google News).
const CATEGORIAS = [
  {
    id: 'ecommerce',
    nome: 'E-commerce & Varejo',
    fontes: [
      { nome: 'Mercado&Consumo', tipo: 'rss', url: 'https://mercadoeconsumo.com.br/feed/' },
      { nome: 'Consumidor Moderno', tipo: 'rss', url: 'https://www.consumidormoderno.com.br/feed/' },
      { nome: 'Modern Retail', tipo: 'rss', url: 'https://www.modernretail.co/feed/' },
      { nome: 'E-Commerce Brasil', tipo: 'gnews', query: 'site:ecommercebrasil.com.br when:14d' },
      { nome: 'Google News', tipo: 'gnews', query: 'e-commerce Brasil (estratégia OR vendas online OR marketplace) when:7d' },
    ],
  },
  {
    id: 'beleza',
    nome: 'Beleza & Capilar',
    fontes: [
      { nome: 'Cosmetic Innovation', tipo: 'rss', url: 'https://cosmeticinnovation.com.br/feed/' },
      { nome: 'Glossy', tipo: 'rss', url: 'https://www.glossy.co/feed/' },
      { nome: 'WWD Beauty', tipo: 'rss', url: 'https://wwd.com/beauty-industry-news/feed/' },
      { nome: 'Google News', tipo: 'gnews', query: '(mercado de beleza OR cosméticos OR cuidado capilar) Brasil when:7d' },
    ],
  },
  {
    id: 'investimento',
    nome: 'Investimento & Mercado',
    fontes: [
      { nome: 'NeoFeed', tipo: 'rss', url: 'https://neofeed.com.br/feed/' },
      { nome: 'Google News', tipo: 'gnews', query: '(beleza OR cosméticos) (aquisição OR investimento OR fusão OR aporte) when:7d' },
      { nome: 'Google News (global)', tipo: 'gnews', lang: 'en', query: 'beauty brand (acquisition OR investment OR funding OR "M&A") when:7d' },
    ],
  },
  {
    id: 'logistica',
    nome: 'Logística',
    fontes: [
      { nome: 'Portais de logística', tipo: 'gnews', query: '(site:tecnologistica.com.br OR site:mundologistica.com.br) when:30d' },
      { nome: 'Google News', tipo: 'gnews', query: '(logística OR Correios OR frete OR última milha) e-commerce Brasil when:7d' },
    ],
  },
  {
    id: 'concorrentes',
    nome: 'Concorrentes (lançamentos)',
    fontes: [
      { nome: 'Google News', tipo: 'gnews', query: '(lançamento OR "nova linha") ("Salon Line" OR "Lola Cosmetics" OR "Braé" OR "Cadiveu" OR "Truss" OR "Inoar" OR "Bio Extratus" OR "Haskell") when:14d' },
      { nome: 'Google News', tipo: 'gnews', query: '(lançamento OR novidade) (capilar OR cabelo) cosmético Brasil when:7d' },
    ],
  },
  {
    id: 'marketing',
    nome: 'Marketing & Venda Digital',
    fontes: [
      { nome: 'Meio & Mensagem', tipo: 'rss', url: 'https://www.meioemensagem.com.br/feed' },
      { nome: 'Google News', tipo: 'gnews', query: '(marketing digital OR mídia paga OR performance) e-commerce Brasil when:7d' },
    ],
  },
];

// ── Parsing de XML (RSS 2.0 e Atom) sem lib ────────────────────────────────
function decodeEntities(s = '') {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .trim();
}
const stripTags = (s = '') => s.replace(/<[^>]*>/g, '');
function firstTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1] : '';
}

function parseFeed(xml) {
  const out = [];
  // RSS <item>
  for (const b of xml.match(/<item[\s\S]*?<\/item>/gi) || []) {
    const titulo = decodeEntities(stripTags(firstTag(b, 'title')));
    let link = decodeEntities(firstTag(b, 'link'));
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); if (m) link = m[1]; }
    const data = firstTag(b, 'pubDate') || firstTag(b, 'dc:date') || '';
    const publisher = decodeEntities(stripTags(firstTag(b, 'source')));
    if (titulo && link) out.push({ titulo, link, data, publisher });
  }
  // Atom <entry>
  for (const b of xml.match(/<entry[\s\S]*?<\/entry>/gi) || []) {
    const titulo = decodeEntities(stripTags(firstTag(b, 'title')));
    let link = '';
    const m = b.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i); if (m) link = m[1];
    const data = firstTag(b, 'updated') || firstTag(b, 'published') || '';
    if (titulo && link) out.push({ titulo, link, data, publisher: '' });
  }
  return out;
}

async function fetchText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; WidiFeedBot/1.0)' },
    });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

// Google News põe " - Publisher" no fim do título; separa fonte de título.
function normalizarGoogleNews(item, fonteFallback) {
  let { titulo, publisher } = item;
  const idx = titulo.lastIndexOf(' - ');
  if (!publisher && idx > 0 && idx > titulo.length - 40) {
    publisher = titulo.slice(idx + 3).trim();
    titulo = titulo.slice(0, idx).trim();
  }
  return { titulo, fonte: publisher || fonteFallback };
}

async function coletarFonte(fonte) {
  const url = fonte.tipo === 'gnews' ? gnews(fonte.query, fonte.lang) : fonte.url;
  const xml = await fetchText(url);
  const brutos = parseFeed(xml).slice(0, POR_FONTE * 3);
  const itens = brutos.map((it) => {
    const base = fonte.tipo === 'gnews'
      ? normalizarGoogleNews(it, fonte.nome)
      : { titulo: it.titulo, fonte: fonte.nome };
    const ts = Date.parse(it.data) || 0;
    return {
      titulo: base.titulo,
      fonte: base.fonte,
      url: it.link,
      ts,
      data: ts ? new Date(ts).toISOString() : null,
    };
  }).filter((x) => x.titulo && x.url);
  return itens.slice(0, POR_FONTE);
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const categorias = [];
  const fontesOk = [];
  const fontesFalha = [];

  for (const cat of CATEGORIAS) {
    const resultados = await Promise.allSettled(cat.fontes.map(coletarFonte));
    let itens = [];
    resultados.forEach((r, i) => {
      const nome = cat.fontes[i].nome + (cat.fontes[i].query ? ` · "${cat.fontes[i].query.slice(0, 32)}…"` : '');
      if (r.status === 'fulfilled' && r.value.length) {
        itens.push(...r.value);
        fontesOk.push(`${cat.nome} → ${nome} (${r.value.length})`);
      } else {
        const motivo = r.status === 'rejected' ? (r.reason?.message || 'erro') : 'vazio';
        fontesFalha.push(`${cat.nome} → ${nome}: ${motivo}`);
      }
    });

    // Dedup por título normalizado
    const visto = new Set();
    itens = itens.filter((x) => {
      const chave = x.titulo.toLowerCase().replace(/\s+/g, ' ').trim();
      if (visto.has(chave)) return false;
      visto.add(chave);
      return true;
    });

    // Mais recentes primeiro (itens sem data vão pro fim)
    itens.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    categorias.push({ id: cat.id, nome: cat.nome, itens: itens.slice(0, POR_CATEGORIA) });
  }

  const total = categorias.reduce((s, c) => s + c.itens.length, 0);
  const saida = {
    gerado_em: new Date().toISOString(),
    total_materias: total,
    fontes_ok: fontesOk.length,
    fontes_falha: fontesFalha,
    categorias,
  };

  await mkdir(join(RAIZ, 'dados'), { recursive: true });
  await writeFile(join(RAIZ, 'dados', 'feed.json'), JSON.stringify(saida, null, 2), 'utf8');

  console.log(`✓ feed.json gerado: ${total} matérias em ${categorias.length} categorias`);
  console.log(`  fontes OK: ${fontesOk.length} | falhas: ${fontesFalha.length}`);
  if (fontesFalha.length) console.log('  ⚠ falhas:\n   - ' + fontesFalha.join('\n   - '));
}

main().catch((e) => {
  console.error('Erro fatal ao gerar feed:', e);
  process.exit(1);
});
