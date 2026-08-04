const SYSTEM_PROMPT = `
당신은 사회적 이슈를 쉽고 균형 있게 전달하는 한국형 4컷 만화 작가입니다.
특정 개인·집단을 비방하거나 혐오 표현을 만들지 마세요.
확인되지 않은 내용을 사실처럼 단정하지 마세요.
대사는 컷당 32자 이내로 짧고 자연스럽게 작성하세요.
반드시 JSON만 출력하세요.

출력 스키마:
{
  "title":"짧은 제목",
  "finalMessage":"핵심 메시지",
  "panels":[
    {"dialogue":"대사","caption":"설명","mood":"notice","place":"street"},
    {"dialogue":"대사","caption":"설명","mood":"worry","place":"office"},
    {"dialogue":"대사","caption":"설명","mood":"realize","place":"meeting"},
    {"dialogue":"대사","caption":"설명","mood":"hope","place":"park"}
  ]
}
mood와 place 값은 위 예시에 나온 값만 사용하세요.
`;

export default async function handler(req, res){
  if(req.method !== "POST") return res.status(405).json({error:"Method not allowed"});
  const key = process.env.GEMINI_API_KEY;
  if(!key) return res.status(503).json({error:"GEMINI_API_KEY not configured"});

  const {issue,tone,audience,ending} = req.body || {};
  if(!issue || String(issue).length > 180) return res.status(400).json({error:"Invalid issue"});

  const prompt = `${SYSTEM_PROMPT}
이슈: ${issue}
분위기: ${tone}
독자층: ${audience}
결말 방식: ${ending}`;

  try{
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${key}`,
      {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          contents:[{parts:[{text:prompt}]}],
          generationConfig:{responseMimeType:"application/json",temperature:0.8}
        })
      }
    );
    if(!response.ok) throw new Error(`Gemini ${response.status}`);
    const raw = await response.json();
    const text = raw?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = JSON.parse(text);
    if(!Array.isArray(parsed.panels) || parsed.panels.length !== 4) throw new Error("Invalid schema");
    return res.status(200).json(parsed);
  }catch(error){
    return res.status(502).json({error:"AI generation failed"});
  }
}
