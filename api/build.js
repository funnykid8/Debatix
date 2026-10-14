
const hits = new Map();
const LIMIT = 10;
const WINDOW = 60 * 60 * 1000;

const LEVELS = [
  "School debate",
  "Parliamentary",
  "Competitive debate"
];

const SIDES = ["For", "Against", "Neutral"];

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const ip = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0].trim() || "unknown";

  const now = Date.now();
  const recent = (hits.get(ip) || [])
    .filter(t => now - t < WINDOW);

  if (recent.length >= LIMIT) {
    return res.status(429).json({ error: "rate_limited" });
  }

  recent.push(now);
  hits.set(ip, recent);

  const { motion, side, level } = req.body || {};

  if (
    typeof motion !== "string" ||
    !motion.trim() ||
    motion.length > 300 ||
    !SIDES.includes(side) ||
    !LEVELS.includes(level)
  ) {
    return res.status(400).json({ error: "bad_input" });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "server_configuration" });
  }

  const stance = side === "Neutral"
    ? `The student has selected NEUTRAL.
Explain the strongest arguments FOR and AGAINST fairly.
Label each argument FOR or AGAINST in its title.
Include counterarguments and responses from both perspectives.
Do not recommend a side or assume the student supports one.`
    : `The student argues ${side.toUpperCase()}.
Develop strong arguments for their chosen side, while fairly
explaining counterarguments.`;

  const prompt = `
You are DEBATRIX, a clear, engaging debate preparation coach
for secondary-school students.

Motion: ${JSON.stringify(motion.trim())}
Format: ${level}
${stance}

Return ONLY valid JSON, no markdown, with this structure:

{
  "framing": "2-3 concise sentences explaining the motion",
  "points": [
    {
      "title": "Argument title",
      "claim": "Clear argument",
      "evidence": "Supporting evidence",
      "source": "Real source name",
      "year": "Year if known",
      "strength": "strong",
      "check": "What the student should verify"
    }
  ],
  "attacks": [
    {
      "they_say": "Counterargument",
      "you_say": "Reasoned response",
      "source": "Research source"
    }
  ],
  "doodle": {
    "headline": "Short headline",
    "hook": "Opening line",
    "pillars": ["Point 1", "Point 2", "Point 3"],
    "numbers": ["Fact 1", "Fact 2", "Fact 3"],
    "comebacks": ["Response 1", "Response 2", "Response 3"],
    "zingers": ["Line 1", "Line 2"],
    "closer": "Closing line"
  }
}

Rules:
- Return 5 distinct arguments and 4 counterargument pairs.
- For Neutral, cover both sides fairly throughout the response.
- Use clear, practical language for students.
- Never invent sources, quotations, statistics or URLs.
- Mark uncertain evidence as shaky.
- Strength must be strong, medium or shaky.
- Make the quick prep sheet reflect the selected position.
- Encourage understanding rather than memorisation.
`;

  try {
    const r = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + process.env.GROQ_API_KEY
        },
        body: JSON.stringify({
          model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
          max_tokens: 3500,
          temperature: 0.4,
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: prompt }]
        })
      }
    );

    if (r.status === 429) {
      return res.status(429).json({ error: "rate_limited" });
    }

    if (!r.ok) {
      return res.status(502).json({ error: "upstream" });
    }

    const data = await r.json();
    const content = data.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed.points) ||
        !Array.isArray(parsed.attacks) ||
        !parsed.doodle) {
      return res.status(502).json({ error: "invalid_ai_response" });
    }

    return res.status(200).json(parsed);
  } catch (e) {
    return res.status(500).json({ error: "failed" });
  }
};

