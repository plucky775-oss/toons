const $ = (s) => document.querySelector(s);
let sourceFilesData = [];
let analysisData = null;
let educationData = null;
const MAX_FILES = 8;
const MAX_PDF_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_SOURCE_BYTES = 12 * 1024 * 1024;

function setStep(step){
  document.querySelectorAll(".steps span").forEach(el=>{
    el.classList.toggle("active", Number(el.dataset.step) <= step);
  });
}

function show(section){
  section.classList.remove("hidden");
  section.scrollIntoView({behavior:"smooth",block:"start"});
}

function escapeHtml(text=""){
  return String(text).replace(/[&<>"']/g,ch=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[ch]));
}

function fileToData(file){
  return new Promise((resolve,reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function compressImage(file){
  const bitmap = await createImageBitmap(file);
  const maxDimension = 1600;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap,0,0,width,height);
  bitmap.close();

  const blob = await new Promise(resolve=>
    canvas.toBlob(resolve,"image/jpeg",0.82)
  );
  if(!blob) throw new Error("이미지 압축에 실패했습니다.");

  return {
    name:file.name.replace(/\.[^.]+$/,"") + ".jpg",
    mimeType:"image/jpeg",
    data:await fileToData(blob),
    originalSize:file.size,
    compressedSize:blob.size,
    previewUrl:URL.createObjectURL(blob),
    kind:"image"
  };
}

async function prepareFile(file){
  if(file.type.startsWith("image/")){
    if(file.size > MAX_IMAGE_SOURCE_BYTES){
      throw new Error(`${file.name}: 원본 사진은 12MB 이하만 가능합니다.`);
    }
    return compressImage(file);
  }

  if(file.type === "application/pdf"){
    if(file.size > MAX_PDF_BYTES){
      throw new Error(`${file.name}: PDF는 4MB 이하만 가능합니다.`);
    }
    return {
      name:file.name,
      mimeType:file.type,
      data:await fileToData(file),
      originalSize:file.size,
      compressedSize:file.size,
      previewUrl:null,
      kind:"pdf"
    };
  }

  throw new Error(`${file.name}: 지원하지 않는 파일 형식입니다.`);
}

function formatBytes(bytes=0){
  if(bytes < 1024) return `${bytes}B`;
  if(bytes < 1024*1024) return `${(bytes/1024).toFixed(0)}KB`;
  return `${(bytes/1024/1024).toFixed(2)}MB`;
}

function moveFile(index,direction){
  const next = index + direction;
  if(next < 0 || next >= sourceFilesData.length) return;
  [sourceFilesData[index],sourceFilesData[next]] =
    [sourceFilesData[next],sourceFilesData[index]];
  renderPreviews();
}

function removeFile(index){
  const item = sourceFilesData[index];
  if(item?.previewUrl) URL.revokeObjectURL(item.previewUrl);
  sourceFilesData.splice(index,1);
  renderPreviews();
}

function renderPreviews(){
  $("#fileCount").textContent = `선택된 자료 ${sourceFilesData.length}개`;
  const grid = $("#previewGrid");

  if(!sourceFilesData.length){
    grid.innerHTML = `<p class="empty-preview">아직 선택한 자료가 없습니다.</p>`;
    return;
  }

  grid.innerHTML = sourceFilesData.map((item,index)=>`
    <article class="preview-card">
      ${item.kind === "image"
        ? `<img src="${item.previewUrl}" alt="${escapeHtml(item.name)} 미리보기">`
        : `<div class="pdf-preview" aria-label="PDF 파일">📄</div>`}
      <div class="order-actions">
        <button type="button" data-move="${index},-1" aria-label="앞으로 이동">←</button>
        <button type="button" data-move="${index},1" aria-label="뒤로 이동">→</button>
      </div>
      <div class="preview-actions">
        <button type="button" data-remove="${index}" aria-label="파일 삭제">×</button>
      </div>
      <div class="preview-meta">
        <strong>${index+1}. ${escapeHtml(item.name)}</strong>
        <span>${item.kind === "image"
          ? `${formatBytes(item.originalSize)} → ${formatBytes(item.compressedSize)}`
          : formatBytes(item.compressedSize)}</span>
      </div>
    </article>
  `).join("");

  grid.querySelectorAll("[data-remove]").forEach(button=>{
    button.addEventListener("click",()=>removeFile(Number(button.dataset.remove)));
  });
  grid.querySelectorAll("[data-move]").forEach(button=>{
    const [index,direction] = button.dataset.move.split(",").map(Number);
    button.addEventListener("click",()=>moveFile(index,direction));
  });
}

$("#sourceFiles").addEventListener("change", async (event)=>{
  const selected = Array.from(event.target.files || []);
  event.target.value = "";
  if(!selected.length) return;

  const remaining = MAX_FILES - sourceFilesData.length;
  if(remaining <= 0){
    $("#status").textContent = `자료는 최대 ${MAX_FILES}개까지 올릴 수 있습니다.`;
    return;
  }

  $("#status").textContent = "사진 크기를 조정하고 있습니다…";
  const accepted = selected.slice(0,remaining);

  try{
    for(const file of accepted){
      sourceFilesData.push(await prepareFile(file));
      renderPreviews();
    }
    if(selected.length > remaining){
      $("#status").textContent = `최대 ${MAX_FILES}개까지만 추가했습니다.`;
    }else{
      $("#status").textContent = `${sourceFilesData.length}개 자료가 준비됐습니다.`;
    }
  }catch(error){
    $("#status").textContent = error.message;
  }
});

$("#clearFilesBtn").addEventListener("click",()=>{
  sourceFilesData.forEach(item=>{
    if(item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  });
  sourceFilesData = [];
  renderPreviews();
});

async function postJson(url,payload){
  const response = await fetch(url,{
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  const data = await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(data.error || `요청 실패 (${response.status})`);
  return data;
}

function renderAnalysis(data){
  $("#accidentSummary").textContent = data.summary || "분석된 사고 개요가 없습니다.";
  $("#sequenceList").innerHTML = (data.sequence || []).map(v=>`<li>${escapeHtml(v)}</li>`).join("");
  $("#confirmedFacts").innerHTML = (data.confirmedFacts || []).map(v=>`<li>${escapeHtml(v)}</li>`).join("");
  $("#causePreview").innerHTML = (data.causeCandidates || []).map(v=>`<span class="chip">${escapeHtml(v.name || v)}</span>`).join("");

  const questions = data.questions || [];
  $("#questionsList").innerHTML = questions.length ? questions.map((q,index)=>{
    const options = Array.isArray(q.options) && q.options.length
      ? `<div class="option-row">${q.options.map((option,optIndex)=>`
          <label><input type="radio" name="question_${index}" value="${escapeHtml(option)}" ${optIndex===0?"checked":""}>${escapeHtml(option)}</label>
        `).join("")}</div>`
      : `<textarea class="question-text" data-question-index="${index}" placeholder="확인 내용을 입력하세요"></textarea>`;
    return `<div class="question-item" data-id="${escapeHtml(q.id || String(index))}">
      <strong>${index+1}. ${escapeHtml(q.question)}</strong>${options}
    </div>`;
  }).join("") : `<p>추가로 확인할 내용이 없습니다. 바로 스토리보드를 만들 수 있습니다.</p>`;
}

$("#analyzeBtn").addEventListener("click",async ()=>{
  if(!sourceFilesData.length && !$("#extraContext").value.trim()){
    $("#status").textContent = "사고자료 파일이나 사고 개요를 입력해주세요.";
    return;
  }
  $("#analyzeBtn").disabled = true;
  $("#status").textContent = "Gemma 4가 사고자료를 분석하고 있습니다…";
  try{
    analysisData = await postJson("/api/analyze-accident",{
      files:sourceFilesData.map(({name,mimeType,data,kind},index)=>({
        name,
        mimeType,
        data,
        kind,
        order:index+1
      })),
      extraContext:$("#extraContext").value.trim(),
      educationUse:$("#educationUse").value
    });
    renderAnalysis(analysisData);
    $("#analysisSection").classList.remove("hidden");
    setStep(2);
    show($("#analysisSection"));
    $("#status").textContent = `분석 완료 · ${analysisData.model || "Gemma 4"}`;
  }catch(error){
    $("#status").textContent = `분석 실패: ${error.message}`;
  }finally{
    $("#analyzeBtn").disabled = false;
  }
});

function collectAnswers(){
  return (analysisData?.questions || []).map((q,index)=>{
    const radio = document.querySelector(`input[name="question_${index}"]:checked`);
    const text = document.querySelector(`textarea[data-question-index="${index}"]`);
    return {
      id:q.id || String(index),
      question:q.question,
      answer:radio?.value || text?.value?.trim() || "사용자 확인 없음"
    };
  });
}

function renderStoryboard(data){
  $("#storyboardCards").innerHTML = (data.storyboard || []).map((panel,index)=>`
    <article class="story-card">
      <span class="cut">${index+1}</span>
      <h4>${escapeHtml(panel.title || `${index+1}컷`)}</h4>
      <textarea data-panel-index="${index}">${escapeHtml(panel.scene || "")}</textarea>
      <p><strong>대사:</strong> ${escapeHtml(panel.dialogue || "")}</p>
      <p><strong>교육 포인트:</strong> ${escapeHtml(panel.educationPoint || "")}</p>
    </article>
  `).join("");
}

async function createStoryboard(){
  $("#confirmAnalysisBtn").disabled = true;
  $("#confirmAnalysisBtn").textContent = "스토리보드 생성 중…";
  try{
    educationData = await postJson("/api/create-education",{
      analysis:analysisData,
      answers:collectAnswers(),
      educationUse:$("#educationUse").value,
      injuryLevel:$("#injuryLevel").value,
      revisionNote:$("#revisionNote").value.trim()
    });
    renderStoryboard(educationData);
    $("#storyboardSection").classList.remove("hidden");
    setStep(3);
    show($("#storyboardSection"));
  }catch(error){
    alert(`스토리보드 생성 실패: ${error.message}`);
  }finally{
    $("#confirmAnalysisBtn").disabled = false;
    $("#confirmAnalysisBtn").textContent = "확인하고 스토리보드 생성";
  }
}

$("#confirmAnalysisBtn").addEventListener("click",createStoryboard);
$("#regenerateStoryboardBtn").addEventListener("click",createStoryboard);
$("#backToUploadBtn").addEventListener("click",()=>show($("#uploadSection")));

function collectEditedStoryboard(){
  return (educationData.storyboard || []).map((panel,index)=>({
    ...panel,
    scene:document.querySelector(`textarea[data-panel-index="${index}"]`)?.value.trim() || panel.scene
  }));
}

function renderResult(data,imageResult){
  $("#materialTitle").textContent = data.title || "안전사고 교육자료";
  $("#resultSummary").textContent = data.summary || analysisData.summary;
  $("#oneLineLesson").textContent = data.oneLineLesson || "";
  const image = imageResult?.imageDataUrl;
  if(image){
    $("#comicImage").src = image;
    $("#comicImage").classList.remove("hidden");
    $("#comicFallback").classList.add("hidden");
  }else{
    $("#comicImage").classList.add("hidden");
    $("#comicFallback").classList.remove("hidden");
    $("#comicFallback").innerHTML = "<strong>이미지 생성에 실패했습니다.</strong><p>스토리보드와 원인 교육자료는 정상 생성되었습니다.</p>";
  }

  $("#resultStoryboard").innerHTML = data.storyboard.map((panel,index)=>`
    <article class="story-card">
      <span class="cut">${index+1}</span>
      <h4>${escapeHtml(panel.title)}</h4>
      <p>${escapeHtml(panel.scene)}</p>
      <p><strong>${escapeHtml(panel.dialogue || "")}</strong></p>
      <p>${escapeHtml(panel.educationPoint || "")}</p>
    </article>
  `).join("");

  const causes = data.causes || [];
  $("#causeButtons").innerHTML = causes.map((cause,index)=>`
    <button type="button" data-cause-index="${index}">${escapeHtml(cause.name)}</button>
  `).join("");

  $("#causeButtons").querySelectorAll("button").forEach(button=>{
    button.addEventListener("click",()=>{
      $("#causeButtons").querySelectorAll("button").forEach(b=>b.classList.remove("active"));
      button.classList.add("active");
      const cause = causes[Number(button.dataset.causeIndex)];
      $("#causeDetail").innerHTML = `
        <h4>${escapeHtml(cause.name)}</h4>
        <dl>
          <dt>왜 위험한가</dt><dd>${escapeHtml(cause.whyDangerous)}</dd>
          <dt>현장 적용 기준</dt><dd>${escapeHtml(cause.fieldStandard)}</dd>
          <dt>예방 행동</dt><dd>${escapeHtml((cause.preventiveActions || []).join(" · "))}</dd>
          <dt>TBM 핵심문구</dt><dd><strong>${escapeHtml(cause.tbmMessage)}</strong></dd>
          <dt>관련 기준 검색어</dt><dd>${escapeHtml((cause.standardKeywords || []).join(", "))}</dd>
        </dl>
        <div class="notice">법령 조문 번호와 사내 기준은 최신 원문을 확인한 뒤 확정하세요.</div>
      `;
    });
  });
  $("#causeButtons button")?.click();

  $("#resultSection").classList.remove("hidden");
  setStep(4);
  show($("#resultSection"));
}

$("#generateImageBtn").addEventListener("click",async ()=>{
  const storyboard = collectEditedStoryboard();
  educationData.storyboard = storyboard;
  $("#generateImageBtn").disabled = true;
  $("#imageStatus").textContent = "Nano Banana 2 Lite가 4컷 만화를 생성하고 있습니다…";
  try{
    const imageResult = await postJson("/api/generate-safety-comic",{
      sourceImages:sourceFilesData
        .filter(item=>item.kind==="image")
        .slice(0,6)
        .map(({name,mimeType,data},index)=>({name,mimeType,data,order:index+1})),
      education:educationData,
      injuryLevel:$("#injuryLevel").value
    });
    renderResult(educationData,imageResult);
    $("#imageStatus").textContent = `완성 · ${imageResult.model || "Nano Banana 2 Lite"}`;
  }catch(error){
    $("#imageStatus").textContent = `그림 생성 실패: ${error.message}`;
    renderResult(educationData,null);
  }finally{
    $("#generateImageBtn").disabled = false;
  }
});

$("#downloadBtn").addEventListener("click",async ()=>{
  const canvas = await html2canvas($("#exportArea"),{scale:2,backgroundColor:"#ffffff"});
  const link = document.createElement("a");
  link.download = `안전사고_교육자료_${new Date().toISOString().slice(0,10)}.png`;
  link.href = canvas.toDataURL("image/png");
  link.click();
});

$("#restartBtn").addEventListener("click",()=>location.reload());
