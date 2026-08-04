# 이슈툰 — 무료 AI 4컷 만화 PWA

유료 이미지 생성 API를 사용하지 않습니다. 앱 내부 SVG 캐릭터와 배경을 조합해 4컷 만화를 만들기 때문에 이미지 생성 비용은 0원입니다.

## 작동 방식

1. 사용자가 사회적 이슈와 분위기를 입력합니다.
2. `GEMINI_API_KEY`가 있으면 Gemini 무료 티어로 대본을 생성합니다.
3. 키가 없거나 무료 한도가 끝나면 내장 오프라인 대본 생성기로 자동 전환합니다.
4. SVG 캐릭터를 조합해 4컷을 만들고 PNG로 저장합니다.

## Vercel 배포

1. 이 폴더를 GitHub 저장소에 올립니다.
2. Vercel에서 저장소를 Import합니다.
3. Vercel 프로젝트 → Settings → Environment Variables에 아래 값을 추가합니다.

```
GEMINI_API_KEY=Google AI Studio에서 발급한 키
```

4. 재배포합니다.

API 키를 넣지 않아도 오프라인 모드로 작동합니다.

## 로컬 실행

Vercel CLI가 설치되어 있다면:

```
npm install -g vercel
vercel dev
```

## 비용

- SVG 그림 생성: 무료
- 오프라인 대본: 무료·무제한
- Gemini 대본: Google이 제공하는 무료 티어 범위 내 무료
- Vercel Hobby 배포: 개인·비상업적 사용 조건 확인 필요

## 다음 확장 아이디어

- 캐릭터 성별·연령·직업 선택
- 표정과 포즈 확대
- 1:1 SNS 이미지 저장
- Firebase 작품 보관함
- 관리자용 금칙어 및 사실확인 단계
