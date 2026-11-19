// language: JavaScript (Node.js), file: api/scrape.js, target: Vercel Serverless Node.js
const DEFAULT_TARGET = "https://cinema.lk/";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,si;q=0.8",
  Referer: DEFAULT_TARGET,
};

function decodeHtml(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripTags(html = "") {
  return decodeHtml(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")).trim();
}

function isAllowedUrl(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (!["http:", "https:"].includes(u.protocol)) return false;
    return u.hostname === "cinema.lk" || u.hostname.endsWith(".cinema.lk");
  } catch (_) {
    return false;
  }
}

function extractItems(html, baseUrl) {
  const items = [];
  const seen = new Set();

  // Article / post / card blocks හරහා title, link, thumbnail ගැනීම
  const articleRegex = /<article\b[^>]*>([\s\S]*?)<\/article>/gi;
  let artMatch;
  while ((artMatch = articleRegex.exec(html)) !== null) {
    const block = artMatch[1];
    const linkMatch = block.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!linkMatch) continue;

    let absUrl;
    try {
      absUrl = new URL(linkMatch[1].trim(), baseUrl).toString();
    } catch (_) {
      continue;
    }

    const imgMatch =
      block.match(/<img\b[^>]*data-src=["']([^"']+)["']/i) ||
      block.match(/<img\b[^>]*src=["']([^"']+)["']/i);
    const titleAttrMatch = block.match(/title=["']([^"']+)["']/i);

    const title =
      stripTags(linkMatch[2]) ||
      (titleAttrMatch ? decodeHtml(titleAttrMatch[1]).trim() : "");

    if (!title || title.length < 2 || seen.has(absUrl)) continue;
    seen.add(absUrl);

    let thumb = null;
    if (imgMatch && imgMatch[1] && !imgMatch[1].startsWith("data:")) {
      try {
        thumb = new URL(imgMatch[1].trim(), baseUrl).toString();
      } catch (_) {
        thumb = null;
      }
    }

    items.push({
      title,
      url: absUrl,
      thumbnail: thumb,
    });
  }

  // Fallback: <article> tags නැත්නම් <a href> links ගැනීම
  if (items.length === 0) {
    const anchorRegex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let aMatch;
    while ((aMatch = anchorRegex.exec(html)) !== null) {
      const rawHref = aMatch[1].trim();
      if (!rawHref || rawHref.startsWith("#") || rawHref.startsWith("javascript:")) continue;

      let absUrl;
      try {
        absUrl = new URL(rawHref, baseUrl).toString();
      } catch (_) {
        continue;
      }

      const title = stripTags(aMatch[2]);
      if (!title || title.length < 2 || seen.has(absUrl)) continue;
      seen.add(absUrl);

      items.push({
        title,
        url: absUrl,
        thumbnail: null,
      });
    }
  }

  return items;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const target = (req.query && req.query.url) || DEFAULT_TARGET;
  if (!isAllowedUrl(target)) {
    return res.status(400).json({
      ok: false,
      error: "Invalid target URL. Only cinema.lk URLs are allowed.",
    });
  }

  try {
    const response = await fetch(target, {
      headers: HEADERS,
      signal: AbortSignal.timeout(9000),
    });

    if (!response.ok) {
      return res.status(502).json({
        ok: false,
        error: `Upstream returned HTTP ${response.status}`,
      });
    }

    const html = await response.text();
    const pageTitleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const items = extractItems(html, target);

    return res.status(200).json({
      ok: true,
      source: target,
      page_title: pageTitleMatch ? stripTags(pageTitleMatch[1]) : null,
      total: items.length,
      items,
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || "Scrape failed",
    });
  }
}
