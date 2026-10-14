
const hits = new Map();
const LIMIT = 10;
const WINDOW = 60 * 60 * 1000;

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST only" });
  }

  const ip = (req.headers["x-forwarded-for"] || "")
    .split(",")[0].trim() || "unknown";
  const now = Date.now();
  const recent = (hits.get(ip) || [])
    .filter(t => now - t < WINDOW);

  if (recent.length >= LIMIT) {
    return res.status(429).json({ error: "rate_limited" });
  }

  recent.push(now);
  hits.set(ip, recent);

  const {
    country,
    committee,
    agenda,
    otherCountries
  } = req.body || {};

  if (
    typeof country !== "string" || !country.trim() ||
    country.length > 100 ||
    typeof committee !== "string" || !committee.trim() ||
    committee.length > 150 ||
    typeof agenda !== "string" || !agenda.trim() ||
    agenda.length > 300 ||
    typeof otherCountries !== "string" ||
    otherCountries.length > 500
  ) {
    return res.status(400).json({ error: "bad_input" });
  }

  const prompt = `
You are DEBATRIX, a practical Model United Nations preparation
coach for secondary-school students.

Represented country: ${country.trim()}
Committee: ${committee.trim()}
Agenda: ${agenda.trim()}
Other delegations to consider: ${otherCountries.trim() || "Not specified"}

Return ONLY valid JSON, without markdown, in this shape:
{
  "overview": "A concise explanation of the agenda and the country's role",
  "openingSpeech": "A draft opening speech suitable for a student delegate",
  "policyPriorities": ["3 to 5 priorities"],
  "countryPosition": ["3 to 5 policy points"],
  "countryDynamics": [
    {
      "country": "Country name",
      "relationship": "Potential area of alignment or disagreement",
      "reason": "Brief explanation",
      "confidence": "high, medium, or verify"
    }
  ],
  "negotiationStrategy": ["4 practical, diplomatic suggestions"],
  "pois": ["5 questions to ask other delegates"],
  "resolutionIdeas": ["3 actionable policy clauses or proposals"],
  "researchChecklist": ["5 specific things to verify before the conference"]
}

Rules:
- Distinguish verified general knowledge from uncertain or changing
  country positions. Never invent official policy, treaties, statistics,
  quotes, or diplomatic alliances.
- Treat country relationships as possible alignments, not guaranteed
  alliances. Mark uncertain claims "verify" and tell the student what
  official source or document to check.
- Keep the language clear, diplomatic, and useful for a student.
- The opening speech should be about 150-200 words, unless the agenda
  clearly calls for a shorter speech.
- POIs must be relevant to the agenda and phrased respectfully.
- Resolution ideas should be realistic, specific, and diplomatic.
- Help the student understand and develop their own position rather
  than simply memorising the output.
- Every array item must be a string unless the schema specifies an object.
`;

  try {
    const r = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "authorization": "Bearer " + process.env.GROQ_API_KEY
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
    const content =
      data.choices?.[0]?.message?.content || "{}";

    return res.status(200).json(JSON.parse(content));
  } catch (e) {
    return res.status(500).json({ error: "failed" });
  }
};

