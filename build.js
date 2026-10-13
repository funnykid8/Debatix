// Serverless function: keeps your Groq API key on the server, never in the page.
const hits = new Map(); // simple per-IP limit (resets when the instance restarts)
const LIMIT = 10, WINDOW = 60 * 60 * 1000;
const LEVELS = ["School debate", "Parliamentary", "Competitive / MUN"];

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter(t => now - t < WINDOW);
  if (recent.length >= LIMIT) return res.status(429).json({ error: "rate_limited" });
  recent.push(now); hits.set(ip, recent);

  const { motion, side, level } = req.body || {};
  if (typeof motion !== "string" || !motion.trim() || motion.length > 300 ||
      !["For", "Against"].includes(side) || !LEVELS.includes(level)) {
    return res.status(400).json({ error: "bad_input" });
  }

  const prompt = `You are Debatrix, a clear, student-friendly debate preparation coach. Help students build understanding and their own reasoning; do not sound childish or overly academic. Motion: "${motion.trim()}". The student argues ${side.toUpperCase()}. Style: ${level}.
Start with concise, useful preparation rather than a lecture. Be practical and specific. Return ONLY valid JSON, no markdown, with this shape:
{"framing":"2-3 concise sentences framing the motion and the chosen side in plain language","points":[5 items {"title","claim","evidence","source","year","strength":"strong|medium|shaky","check"}],"attacks":[4 items {"they_say","you_say","source"}],"doodle":{"headline":"max 6 words","hook":"one punchy opening line","pillars":[3 short strings],"numbers":[3 short stat or fact strings each naming its source],"comebacks":[3 short 'If they say X -> say Y' strings],"zingers":[2 short lines],"closer":"one line"}}
Rules: Write for secondary-school students without talking down to them. Avoid filler, generic motivational language, or long explanations. Make arguments distinct rather than repeating the same point. Only cite real, well-known sources you are confident exist (named studies, institutions, reports, laws, court cases, major datasets). Never invent a URL, DOI, quote, or statistic. If you are unsure of an exact figure, describe it in words instead of giving a number, and mark strength "shaky". "check" must say exactly what to search for to verify the claim. Keep every string under 40 words. Be fair: do not overstate what the evidence shows.`;

  try {
    const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": "Bearer " + process.env.GROQ_API_KEY
      },
      body: JSON.stringify({
        model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
        max_tokens: 3000,
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (r.status === 429) return res.status(429).json({ error: "rate_limited" });
    if (!r.ok) return res.status(502).json({ error: "upstream" });
    const data = await r.json();
    let text = (data.choices && data.choices[0] && data.choices[0].message.content) || "";
    text = text.replace(/```json|```/g, "");
    text = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    return res.status(200).json(JSON.parse(text));
  } catch (e) {
    return res.status(500).json({ error: "failed" });
  }
};
