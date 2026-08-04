function normalizeModelName(value = "") {
  return String(value)
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/^ANALYSIS_MODEL\s*=\s*/i, "")
    .replace(/^models\//i, "")
    .replace(/\s+/g, "");
}

function getModelCandidates() {
  const requested = normalizeModelName(
    process.env.ANALYSIS_MODEL || process.env.GEMMA_MODEL || ""
  );

  return [...new Set([
    requested,
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash-lite",
    "gemini-2.5-flash"
  ].filter(Boolean))];
}

function isModelNameError(status, message = "") {
  return status === 400 &&
    /model|unexpected model name format|not found|not supported/i.test(message);
}

function stripCodeFences(text = "") {
  return String(text)
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractBalancedJson(text = "") {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf("{");
  if (start < 0) throw new Error("대본 JSON 시작 문자를 찾지 못했습니다.");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < cleaned.length; index++) {
    const char = cleaned[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(start, index + 1);
    }
  }

  throw new Error("완성된 대본 JSON을 찾지 못했습니다.");
}

function extractJson(text = "") {
  const candidates = [stripCodeFences(text), extractBalancedJson(text)];
  let lastError;

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate.replace(/,\s*([}\]])/g, "$1"));
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("대본 JSON 응답 오류");
}

function validateEducation(data) {
  if (!data || typeof data !== "object") {
    throw new Error("교육자료 응답 형식이 올바르지 않습니다.");
  }

  if (!Array.isArray(data.storyboard) || data.storyboard.length !== 4) {
    throw new Error("4컷 스토리보드가 올바르지 않습니다.");
  }

  data.title = String(data.title || "안전사고 교육자료");
  data.summary = String(data.summary || "");
  data.oneLineLesson = String(data.oneLineLesson || "");
  data.causes = Array.isArray(data.causes) ? data.causes.slice(0, 6) : [];
  return data;
}

async function generateWithFallback(apiKey, prompt) {
  const candidates = getModelCandidates();
  let lastError;

  for (const model of candidates) {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.25,
            maxOutputTokens: 3500,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const raw = await response.json().catch(() => ({}));

    if (response.ok) {
      const outputText = raw?.candidates?.[0]?.content?.parts
        ?.map(part => part?.text || "")
        .join("")
        .trim() || "";

      if (!outputText) {
        throw new Error("Gemini AI가 빈 대본을 반환했습니다.");
      }

      return { outputText, usedModel: model };
    }

    const message = raw?.error?.message || `Gemini API ${response.status}`;
    lastError = new Error(message);
    lastError.status = response.status;

    if (!isModelNameError(response.status, message)) {
      throw lastError;
    }
  }

  throw lastError || new Error("사용 가능한 대본 생성 모델을 찾지 못했습니다.");
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store, max-age=0");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: "GEMINI_API_KEY가 없습니다." });
  }

  const {
    analysis,
    answers,
    educationUse,
    injuryLevel,
    revisionNote
  } = req.body || {};

  const prompt = `
너는 산업안전 교육용 4컷 만화의 대본 작가이자 교육자료 편집자다.
아래 사고 분석과 사용자 확인 답변에만 근거하여 작성하라.

절대 규칙:
- 없는 장비, 인물, 작업방법, 사고결과를 추가하지 않는다.
- 사람, 자재, 전주 등 행동의 주어를 바꾸지 않는다.
- 불확실한 내용을 확정적으로 표현하지 않는다.
- 법령 조문 번호를 임의로 만들지 않는다.
- 과도한 부상, 피, 상처를 묘사하지 않는다.

사고 분석:
${JSON.stringify(analysis || {}).slice(0, 16000)}

사용자 확인:
${JSON.stringify(answers || []).slice(0, 5000)}

교육 용도: ${String(educationUse || "안전교육")}
부상 표현: ${String(injuryLevel || "교육용으로 약하게")}
추가 수정 지시: ${String(revisionNote || "없음").slice(0, 1000)}

4컷 구성:
1컷: 작업 시작과 주변 위험
2컷: 사고로 이어진 위험상황 또는 부적절한 조치
3컷: 실제 사고 경위, 비유혈·비고어 표현
4컷: 올바른 작업방법과 예방대책

반드시 아래 구조의 JSON 객체 하나만 출력:
{
  "title": "교육자료 제목",
  "summary": "사고 개요",
  "oneLineLesson": "기억할 한 줄 교훈",
  "storyboard": [
    {
      "title": "컷 제목",
      "scene": "그림으로 표현할 구체적인 장면",
      "dialogue": "짧은 대사",
      "educationPoint": "교육 포인트"
    }
  ],
  "causes": [
    {
      "name": "사고 원인",
      "category": "관리적 또는 기술적 또는 인적 또는 환경적",
      "whyDangerous": "왜 사고로 연결되는지",
      "fieldStandard": "현장에서 지켜야 할 일반 원칙",
      "preventiveActions": ["구체적인 예방 행동"],
      "tbmMessage": "TBM 중점관리사항 한 문장",
      "standardKeywords": ["관련 기준 검색어"]
    }
  ]
}

storyboard는 정확히 4개, causes는 2~6개로 작성하라.
`;

  try {
    const generation = await generateWithFallback(apiKey, prompt);
    const education = validateEducation(extractJson(generation.outputText));

    return res.status(200).json({
      ...education,
      model: generation.usedModel
    });
  } catch (error) {
    console.error("Storyboard generation failed:", error);
    return res.status(error.status || 502).json({
      error: error.message || "교육자료 생성 실패"
    });
  }
}
