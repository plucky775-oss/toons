const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || process.env.GEMMA_MODEL || "gemini-3.1-flash-lite";

function extractJson(text=""){
  const cleaned=String(text).replace(/```json/gi,"").replace(/```/g,"").trim();
  try{return JSON.parse(cleaned)}catch{
    const s=cleaned.indexOf("{"),e=cleaned.lastIndexOf("}");
    if(s<0||e<=s) throw new Error("JSON 응답 오류");
    return JSON.parse(cleaned.slice(s,e+1));
  }
}

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Method not allowed"});
  const apiKey=process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY;
  if(!apiKey) return res.status(503).json({error:"GEMINI_API_KEY가 없습니다."});
  const {analysis,answers,educationUse,injuryLevel,revisionNote}=req.body||{};

  const prompt=`
너는 산업안전 교육용 4컷 만화의 대본 작가이자 교육자료 편집자다.
아래 사고 분석과 사용자 확인 답변에만 근거하여 콘텐츠를 작성하라.
없는 장비·인물·작업방법·사고결과를 추가하지 마라.
불확실한 내용을 확정적으로 표현하지 마라.
법령 조문 번호는 만들지 말고 관련 기준을 찾기 위한 검색어만 제공하라.

사고 분석:
${JSON.stringify(analysis).slice(0,16000)}

사용자 확인:
${JSON.stringify(answers).slice(0,5000)}

교육 용도: ${educationUse}
부상 표현: ${injuryLevel}
추가 수정 지시: ${revisionNote||"없음"}

4컷 구성:
1컷 작업 시작과 주변 위험
2컷 사고로 이어진 위험상황 또는 잘못된 조치
3컷 실제 사고 경위(비유혈·비고어, 자료 범위)
4컷 올바른 작업방법과 예방대책

JSON만 출력:
{
 "title":"교육자료 제목",
 "summary":"사고 개요",
 "oneLineLesson":"기억할 한 줄 교훈",
 "storyboard":[
  {"title":"작업 시작 전","scene":"구체적인 그림 장면","dialogue":"짧은 대사","educationPoint":"교육 포인트"}
 ],
 "causes":[
  {
   "name":"사고 원인",
   "category":"관리적|기술적|인적|환경적",
   "whyDangerous":"왜 사고로 연결되는지",
   "fieldStandard":"현장에서 지켜야 할 일반 원칙",
   "preventiveActions":["구체적인 예방 행동"],
   "tbmMessage":"TBM 중점관리사항 한 문장",
   "standardKeywords":["관련 법령·KOSHA·사내기준 검색어"]
  }
 ]
}
스토리보드는 정확히 4개, 원인은 2~6개로 작성하라.
`;

  try{
    const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ANALYSIS_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`,{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{role:"user",parts:[{text:prompt}]}],
        generationConfig:{temperature:0.3,maxOutputTokens:3500,responseMimeType:"application/json"}
      })
    });
    const raw=await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(raw?.error?.message||`Gemini API ${response.status}`);
    const text=raw?.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("")||"";
    const data=extractJson(text);
    if(!Array.isArray(data.storyboard)||data.storyboard.length!==4) throw new Error("4컷 대본이 올바르지 않습니다.");
    return res.status(200).json({...data,model:MODEL});
  }catch(error){
    return res.status(502).json({error:error.message||"교육자료 생성 실패"});
  }
}
