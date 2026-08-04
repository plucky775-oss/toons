const MODEL = process.env.GEMMA_MODEL || "gemma-4-26b-a4b-it";

function cleanLine(value = "") {
  return String(value)
    .replace(/^[\s\-•*○□☑✅]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitItems(text = "") {
  return String(text)
    .split(/\r?\n/)
    .map(cleanLine)
    .filter(Boolean);
}

function section(text, name) {
  const pattern = new RegExp(
    `\\[${name}\\]\\s*([\\s\\S]*?)(?=\\n\\[[A-Z_]+\\]|$)`,
    "i"
  );
  return text.match(pattern)?.[1]?.trim() || "";
}

function parseSourceObservations(text = "") {
  return splitItems(text).map(line => {
    const parts = line.split("|").map(v => v.trim());
    return {
      source: parts[0] || "입력 자료",
      observation: parts[1] || parts[0] || "",
      confidence: parts[2] === "중간" ? "중간" : "높음"
    };
  });
}

function parseCauses(text = "") {
  const allowed = new Set(["관리적", "기술적", "인적", "환경적"]);
  return splitItems(text).map(line => {
    const parts = line.split("|").map(v => v.trim());
    return {
      name: parts[0] || "사고 원인",
      category: allowed.has(parts[1]) ? parts[1] : "관리적",
      evidence: parts[2] || "입력 자료에서 확인 필요"
    };
  });
}

function parseQuestions(text = "") {
  return splitItems(text).slice(0, 4).map((line, index) => {
    const parts = line.split("|").map(v => v.trim());
    const options = (parts[1] || "확인됨/확인되지 않음/모름")
      .split("/")
      .map(cleanLine)
      .filter(Boolean);

    return {
      id: `q${index + 1}`,
      question: parts[0] || "확인이 필요한 내용",
      options: options.length ? options.slice(0, 6) : ["확인됨", "확인되지 않음", "모름"]
    };
  });
}

function parseMarkedResponse(text = "") {
  const normalized = String(text)
    .replace(/```[\w-]*/g, "")
    .replace(/```/g, "")
    .replace(/\r/g, "")
    .trim();

  const summary = section(normalized, "SUMMARY");
  if (!summary) {
    throw new Error("Gemma 4 응답에서 사고 개요를 찾지 못했습니다.");
  }

  return {
    summary: cleanLine(summary),
    workDescription: cleanLine(section(normalized, "WORK")),
    sequence: splitItems(section(normalized, "SEQUENCE")),
    confirmedFacts: splitItems(section(normalized, "CONFIRMED_FACTS")),
    sourceObservations: parseSourceObservations(
      section(normalized, "SOURCE_OBSERVATIONS")
    ),
    causeCandidates: parseCauses(section(normalized, "CAUSES")),
    hazards: splitItems(section(normalized, "HAZARDS")),
    questions: parseQuestions(section(normalized, "QUESTIONS")),
    sensitiveDetails: splitItems(section(normalized, "SENSITIVE"))
  };
}

function extractText(raw) {
  return raw?.candidates?.[0]?.content?.parts
    ?.map(part => part?.text || "")
    .join("")
    .trim() || "";
}

async function callGemma(apiKey, parts) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.1,
          topP: 0.8,
          maxOutputTokens: 2600
        }
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
  const safeFiles = Array.isArray(files) ? files.slice(0, 8) : [];
  const parts = [];

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

입력된 자료와 보충 설명을 함께 분석하라.
자료가 없고 보충 설명만 있으면 그 문장에 적힌 사실만 사용하라.

절대 지켜야 할 원칙:
- 자료에 없는 사람, 장비, 행동, 원인, 사고결과를 추가하지 않는다.
- 사람, 자재, 전주 등 행동의 주어를 임의로 바꾸지 않는다.
- 사진만으로 확정할 수 없는 내용은 확인된 사실로 쓰지 않는다.
- 불명확한 내용은 QUESTIONS에 넣는다.
- 사고 원인은 입력 내용에서 근거가 있는 후보만 제시한다.
- 법령 조문 번호를 만들지 않는다.
- 아래 표식과 순서를 정확히 지킨다.
- JSON, 마크다운 표, 코드블록을 사용하지 않는다.

보충 설명:
${String(extraContext || "없음").slice(0, 2000)}

교육 용도:
${String(educationUse || "안전교육")}

반드시 아래 형식으로만 출력:

[SUMMARY]
사고 개요 2~4문장

[WORK]
작업 내용 한 문장

[SEQUENCE]
- 시간 순서 1
- 시간 순서 2

[CONFIRMED_FACTS]
- 입력에서 직접 확인되는 사실

[SOURCE_OBSERVATIONS]
- 자료 번호 또는 파일명 | 직접 관찰되는 내용 | 높음
- 자료 번호 또는 파일명 | 직접 관찰되는 내용 | 중간

[CAUSES]
- 원인명 | 관리적 | 입력 내용의 근거
- 원인명 | 기술적 | 입력 내용의 근거
카테고리는 관리적, 기술적, 인적, 환경적 중 하나만 사용

[HAZARDS]
- 위험요인

[QUESTIONS]
- 확인 질문 | 선택지1/선택지2/기타 또는 모름
질문이 없으면 아무 항목도 쓰지 말 것

[SENSITIVE]
- 개인정보 또는 가려야 할 내용
없으면 아무 항목도 쓰지 말 것
`
  });

  try {
    let text = await callGemma(apiKey, parts);

    try {
      const data = parseMarkedResponse(text);
      return res.status(200).json({
        ...data,
        model: MODEL,
        parseMode: "markers"
      });
    } catch (firstError) {
      // 한 번만 형식 교정 요청. 내용 재분석은 하지 않는다.
      const repairText = await callGemma(apiKey, [{
        text: `
아래 응답의 내용은 변경하지 말고 표식 형식만 정확하게 고쳐라.
JSON과 코드블록은 절대 사용하지 마라.
반드시 [SUMMARY]부터 [SENSITIVE]까지의 표식을 사용하라.

원본 응답:
${String(text).slice(0, 14000)}
`
      }]);

      const repaired = parseMarkedResponse(repairText);
      return res.status(200).json({
        ...repaired,
        model: MODEL,
        parseMode: "markers-repaired"
      });
    }
  } catch (error) {
    console.error("Accident analysis failed:", error);
    return res.status(error.status || 502).json({
      error: error.message || "사고 분석 실패"
    });
  }
}
