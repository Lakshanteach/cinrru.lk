// language: JavaScript (Node.js), file: api/health.js, target: Vercel Serverless Node.js
export default function handler(req, res) {
  res.status(200).json({ ok: true, service: "cinema-scraper-api", timestamp: Date.now() });
}
