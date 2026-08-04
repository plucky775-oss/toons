const MODEL = process.env.GEMMA_MODEL || "gemma-4-26b-a4b-it";

const SYSTEM_PROMPT = `
당신은 한국 사회의 다양한 이슈를 쉽고 균형 있게 전달하는 4컷 만화 전문 작가입니다.

[안전·품질 원칙]
- 특정 개인이나 집단을 비방하거나 혐오하지 마세요.
- 확인되지 않은 주장을 사실처럼 단정하지 마세요.
- 정치·사회적 쟁점은 한쪽의 선전물이 되지 않도록 균형 있게 구성하세요.
- 실제 피해자나 재난을 희화화하지 마세요.
- 대사는 컷당 32자 이내로 짧고 자연스럽게 작성하세요.
- 1컷은 상황 제시, 2컷은 갈등, 3컷은 깨달음·반전, 4컷은 메시지로 구성하세요.
- 반드시 아래 JSON 구조만 출력하세요. 마크다운 코드블록과 설명은 출력하지 마세요.

{
  "title": "짧고 흥미로운 제목",
  "finalMessage": "독자가 기억할 핵심 메시지",
  "panels": [
    {
      "dialogue": "1컷 대사",
      "caption": "1컷 상황 설명",
      "mood": "notice",
      "place": "street"
    },
    {
      "dialogue": "2컷 대사",
      "caption": "2컷 상황 설명",
      "mood": "worry",
      "place": "office"
    },
    {
      "dialogue": "3컷 대사",
      "caption": "3컷 상황 설명",
      "mood": "realize",
      "place": "meeting"
    },
    {
      "dialogue": "4컷 대사",
      "caption": "4컷 상황 설명",
      "mood": "hope",
      "place": "park"
    }
  ]
}

mood는 notice, worry, realize, hope 중 하나만 사용하세요.
place는 street, office, meeting, park 중 하나만 사용하세요.
`;

function extractJson(text = "") {
  const cleaned = String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end <= start) throw new Error("JSON object not found");
    return JSON.parse(cleaned.slice(start, end + 1));
  }
}

function validateComic(data) {
  const moods = new Set(["notice", "worry", "realize", "hope"]);
  const places = new Set(["street", "office", "meeting", "park"]);

  if (!data || typeof data !== "object") throw new Error("Invalid response");
  if (!Array.isArray(data.panels) || data.panels.length !== 4) {
    throw new Error("Four panels are required");
  }

  data.title = String(data.title || "오늘의 이슈툰").slice(0, 60);
  data.finalMessage = String(data.finalMessage || "작은 관심이 변화를 만듭니다.").slice(0, 100);

  data.panels = data.panels.map((panel, index) => ({
    dialogue: String(panel?.dialogue || "").slice(0, 50),
    caption: String(panel?.caption || "").slice(0, 80),
    mood: moods.has(panel?.mood) ? panel.mood : ["notice", "worry", "realize", "hope"][index],
    place: places.has(panel?.place) ? panel.place : ["street", "office", "meeting", "park"][index]
  }));

  return data;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "Gemma API key is not configured" });
  }

  const { issue, tone, audience, ending } = req.body || {};
  const normalizedIssue = String(issue || "").trim();

  if (!normalizedIssue || normalizedIssue.length > 180) {
    return res.status(400).json({ error: "Invalid issue" });
  }

  const userPrompt = `
[사용자 입력]
사회적 이슈: ${normalizedIssue}
만화 분위기: ${String(tone || "공감형")}
주요 독자층: ${String(audience || "일반 성인")}
결말 방식: ${String(ending || "해결 메시지")}

위 조건에 맞는 한국어 4컷 만화 대본을 작성하세요.
`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: SYSTEM_PROMPT }]
          },
          contents: [
            {
              role: "user",
              parts: [{ text: userPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.85,
            topP: 0.9,
            maxOutputTokens: 1400,
            thinkingConfig: {
              thinkingLevel: "minimal"
            }
          }
        })
      }
    );

    const raw = await response.json();

    if (!response.ok) {
      console.error("Gemma API error:", raw);
      return res.status(response.status).json({
        error: raw?.error?.message || "Gemma API request failed"
      });
    }

    const text = raw?.candidates?.[0]?.content?.parts
      ?.map(part => part?.text || "")
      .join("")
      .trim();

    if (!text) throw new Error("Gemma returned an empty response");

    const comic = validateComic(extractJson(text));

    return res.status(200).json({
      ...comic,
      model: MODEL,
      provider: "Google Gemini API / Gemma hosted model"
    });
  } catch (error) {
    console.error("Gemma generation failed:", error);
    return res.status(502).json({ error: "Gemma 4 generation failed" });
  }
}
