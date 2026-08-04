const MODEL = process.env.GEMMA_MODEL || "gemma-4-26b-a4b-it";

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  required: [
    "summary",
    "workDescription",
    "sequence",
    "confirmedFacts",
    "sourceObservations",
    "causeCandidates",
    "hazards",
    "questions",
    "sensitiveDetails"
  ],
  properties: {
    summary: { type: "STRING" },
    workDescription: { type: "STRING" },
    sequence: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    confirmedFacts: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    sourceObservations: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["source", "observation", "confidence"],
        properties: {
          source: { type: "STRING" },
          observation: { type: "STRING" },
          confidence: {
            type: "STRING",
            enum: ["높음", "중간"]
          }
        }
      }
    },
    causeCandidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["name", "category", "evidence"],
        properties: {
          name: { type: "STRING" },
          category: {
            type: "STRING",
            enum: ["관리적", "기술적", "인적", "환경적"]
          },
          evidence: { type: "STRING" }
        }
      }
    },
    hazards: {
      type: "ARRAY",
      items: { type: "STRING" }
    },
    questions: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        required: ["id", "question", "options"],
        properties: {
          id: { type: "STRING" },
          question: { type: "STRING" },
          options: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        }
      }
    },
    sensitiveDetails: {
      type: "ARRAY",
      items: { type: "STRING" }
    }
  }
};

function stripCodeFences(text = "") {
  return String(text)
    .replace(/^\uFEFF/, "")
    .replace(/```json/gi, "")
    .replace(/```javascript/gi, "")
    .replace(/```/g, "")
    .trim();
}

function extractBalancedObject(text = "") {
  const cleaned = stripCodeFences(text);
  const first = cleaned.indexOf("{");
  if (first < 0) throw new Error("JSON 객체 시작 문자를 찾지 못했습니다.");

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = first; i < cleaned.length; i++) {
    const char = cleaned[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) return cleaned.slice(first, i + 1);
    }
  }

  throw new Error("완성된 JSON 객체를 찾지 못했습니다.");
}

function normalizeJsonText(text = "") {
  return extractBalancedObject(text)
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

function parseJson(text = "") {
  const attempts = [
    () => JSON.parse(stripCodeFences(text)),
    () => JSON.parse(extractBalancedObject(text)),
    () => JSON.parse(normalizeJsonText(text))
  ];

  let lastError;
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("JSON 응답을 해석하지 못했습니다.");
}

function validateAnalysis(data) {
  if (!data || typeof data !== "object") {
    throw new Error("분석 결과가 객체 형식이 아닙니다.");
  }

  const arrayFields = [
    "sequence",
    "confirmedFacts",
    "sourceObservations",
    "causeCandidates",
    "hazards",
    "questions",
    "sensitiveDetails"
  ];

  for (const field of arrayFields) {
    if (!Array.isArray(data[field])) data[field] = [];
  }

  data.summary = String(data.summary || "사고 개요를 확인하지 못했습니다.");
  data.workDescription = String(data.workDescription || "");

  data.questions = data.questions.slice(0, 4).map((question, index) => ({
    id: String(question?.id || `q${index + 1}`),
    question: String(question?.question || "확인이 필요한 내용"),
    options: Array.isArray(question?.options) && question.options.length
      ? question.options.map(String).slice(0, 6)
      : ["확인됨", "확인되지 않음", "모름"]
  }));

  return data;
}

function extractText(raw) {
  return raw?.candidates?.[0]?.content?.parts
    ?.map(part => part?.text || "")
    .join("")
    .trim() || "";
}

async function callGemma(apiKey, parts, useSchema = true) {
  const generationConfig = {
    temperature: 0.15,
    maxOutputTokens: 3200,
    responseMimeType: "application/json"
  };

  if (useSchema) {
    generationConfig.responseSchema = RESPONSE_SCHEMA;
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig
      })
    }
  );

  const raw = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      raw?.error?.message || `Gemma API HTTP ${response.status}`
    );
    error.status = response.status;
    throw error;
  }

  const text = extractText(raw);
  if (!text) throw new Error("Gemma 4가 빈 응답을 반환했습니다.");

  return text;
}

async function repairJson(apiKey, brokenText) {
  const repairPrompt = `
아래 내용은 산업안전 사고 분석 결과이지만 JSON 형식이 깨져 있습니다.

해야 할 일:
- 내용을 새로 분석하거나 추측하지 말 것
- 기존 의미를 유지할 것
- 누락된 필드는 빈 문자열 또는 빈 배열로 채울 것
- 반드시 유효한 JSON 객체 하나만 출력할 것
- 마크다운 코드블록과 설명 문장은 출력하지 말 것

필수 필드:
summary, workDescription, sequence, confirmedFacts, sourceObservations,
causeCandidates, hazards, questions, sensitiveDetails

깨진 응답:
${String(brokenText).slice(0, 14000)}
`;

  return callGemma(
    apiKey,
    [{ text: repairPrompt }],
    true
  );
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

  const { files, extraContext, educationUse } = req.body || {};
  const parts = [];
  const safeFiles = Array.isArray(files) ? files.slice(0, 8) : [];

  for (const file of safeFiles) {
    if (file?.data && file?.mimeType) {
      parts.push({
        text: `자료 ${file.order || ""}: ${file.name || "이름 없음"}`
      });
      parts.push({
        inlineData: {
          mimeType: file.mimeType,
          data: file.data
        }
      });
    }
  }

  parts.push({
    text: `
너는 산업안전 사고조사 자료를 교육용으로 구조화하는 분석가다.

입력된 여러 자료를 순서대로 함께 비교하여 분석하라.
보고서 사진, 현장사진, 작업 전후 사진 사이의 공통점과 차이를 확인하되,
문서에 명시된 사실과 사진에서 직접 관찰되는 사실을 구분하라.

절대 지켜야 할 원칙:
- 자료에 없는 사람, 장비, 행동, 원인, 사고결과를 추가하지 않는다.
- "사람이 넘어짐", "자재가 넘어짐", "전주가 넘어짐"처럼 주어를 바꾸지 않는다.
- 사진만으로 확정할 수 없는 내용은 확인된 사실로 쓰지 않는다.
- 문장이 모호하면 질문으로 만든다.
- 질문은 만화의 사실 정확도에 꼭 필요한 것만 0~4개 작성한다.
- 사고 원인은 자료상 근거가 있는 후보만 제시한다.
- 개인정보와 민감정보는 sensitiveDetails에 분류한다.
- JSON 이외의 문장을 출력하지 않는다.

보충 설명:
${String(extraContext || "없음").slice(0, 2000)}

교육 용도:
${String(educationUse || "안전교육")}
`
  });

  let firstText = "";

  try {
    try {
      firstText = await callGemma(apiKey, parts, true);
    } catch (schemaError) {
      // 일부 Gemma 배포 환경이 responseSchema를 거부할 경우 JSON MIME만으로 재시도.
      if (schemaError.status === 400) {
        firstText = await callGemma(apiKey, parts, false);
      } else {
        throw schemaError;
      }
    }

    let parsed;

    try {
      parsed = parseJson(firstText);
    } catch {
      const repairedText = await callGemma(
        apiKey,
        [{
          text: `
다음 응답을 의미 변경 없이 유효한 JSON 객체 하나로만 복구하라.
설명과 코드블록은 쓰지 마라.

필수 필드:
summary, workDescription, sequence, confirmedFacts, sourceObservations,
causeCandidates, hazards, questions, sensitiveDetails

원본:
${String(firstText).slice(0, 14000)}
`
        }],
        true
      );
      parsed = parseJson(repairedText);
    }

    const data = validateAnalysis(parsed);

    return res.status(200).json({
      ...data,
      model: MODEL,
      jsonMode: true
    });
  } catch (error) {
    console.error("Accident analysis failed:", error);
    console.error("Raw model text:", firstText.slice(0, 3000));

    return res.status(error.status || 502).json({
      error: error.message || "사고 분석 실패"
    });
  }
}
