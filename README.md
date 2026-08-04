# AI 안전사고 교육자료 생성기

사고보고서 사진·현장사진·작업 전후 사진·PDF를 최대 8개까지 입력하면 다음 과정을 수행합니다.

1. Gemma 4 사고분석
2. 확인된 사실과 불명확한 내용 분리
3. 사용자 확인
4. 4컷 스토리보드 생성
5. Nano Banana 2 Lite로 2×2 4컷 만화 생성
6. 사고 원인별 위험성·현장 기준·예방행동·TBM 문구 제공
7. PNG 저장

## Vercel 환경변수

```text
GEMINI_API_KEY=Google AI Studio API 키
GEMMA_MODEL=gemma-4-26b-a4b-it
IMAGE_MODEL=gemini-3.1-flash-lite-image
```

각 항목을 Vercel Environment Variables에 별도로 등록한 뒤 재배포합니다.

## 중요 설계 원칙

- 보고서에 없는 장비, 사람, 작업방법, 사고결과를 추측하지 않음
- 주어가 불명확한 내용은 사용자에게 먼저 질문
- 그림 생성 전에 스토리보드를 사용자가 확인·수정
- 법령 조문 번호를 AI가 임의 생성하지 않음
- 원인별 기준은 일반 원칙과 검색어를 제공하며 최신 원문 검토 필요

## 제한

- 업로드 파일은 브라우저에서 Base64로 전송하므로 4MB 이하 권장
- 이미지 생성 모델은 유료 티어 또는 결제 설정이 필요할 수 있음
- PDF가 이미지 스캔본이거나 화질이 낮으면 분석 정확도가 떨어질 수 있음


## 다중 자료 업로드

- 최대 8개 파일 업로드
- JPG, PNG, WEBP, PDF 지원
- 사진은 브라우저에서 최대 1600px, JPEG 품질 0.82로 자동 압축
- PDF는 파일당 최대 4MB
- 미리보기에서 삭제 및 순서 변경 가능
- Gemma 4는 모든 자료를 함께 비교 분석
- Nano Banana에는 참고 이미지 최대 6장을 전달
- 업로드 순서가 분석 자료 번호와 참고 이미지 순서가 됨


## JSON 분석 오류 개선

- `responseMimeType: application/json` 적용
- 지원되는 경우 JSON 응답 스키마 적용
- 스키마 미지원 400 오류 시 JSON MIME 방식으로 자동 재시도
- 코드블록·앞뒤 설명 제거
- 중괄호 균형을 검사해 JSON 객체만 추출
- 후행 쉼표와 제어문자 정리
- 파싱 실패 시 Gemma 4에 JSON 복구 요청 1회 수행


## 2026-08-05 분석 형식 안정화

Gemma 4가 유효하지 않은 JSON을 반복 출력하는 문제 때문에 분석 응답 형식을 변경했습니다.

- Gemma 4 출력: `[SUMMARY]`, `[SEQUENCE]` 같은 고정 표식
- 서버: 표식별 텍스트를 직접 구조화하여 프론트엔드에 JSON으로 반환
- JSON 생성은 AI가 아니라 서버 코드가 담당
- 형식이 누락되면 Gemma 4에 표식 교정만 1회 요청
- 사진 없이 짧은 사고 개요만 입력해도 동일하게 작동


## 분석 모델 자동 전환

기본 분석 모델은 `gemini-2.5-flash-lite`입니다.

환경변수에 아래처럼 잘못 입력해도 코드가 자동 정리합니다.

```text
models/gemini-2.5-flash-lite
ANALYSIS_MODEL=gemini-2.5-flash-lite
"gemini-2.5-flash-lite"
```

모델명이 잘못되거나 지원되지 않으면 다음 순서로 자동 재시도합니다.

1. Vercel의 `ANALYSIS_MODEL`
2. `gemini-2.5-flash-lite`
3. `gemini-2.5-flash`


## 이미지 API v1 수정

이미지 생성 요청을 `v1beta`에서 공식 REST 예시와 같은 `v1`로 변경했습니다.

자동 시도 순서:

1. Vercel `IMAGE_MODEL`
2. `gemini-3.1-flash-lite-image`
3. `gemini-3.1-flash-image`
4. `gemini-2.5-flash-image`

`gemini-2.5-flash-image`는 참고 이미지 입력을 최대 3장으로 제한하여 전달합니다.
모델이 존재하지만 결제나 할당량이 없는 경우에는 자동 전환으로 해결되지 않으며,
Google AI Studio 프로젝트의 결제 및 Rate Limits를 확인해야 합니다.
