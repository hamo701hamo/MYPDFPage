# PDF 페이지 정리

브라우저에서 PDF 페이지를 삭제·재배치하고, 여러 PDF를 하나로 합치는 가벼운 웹앱입니다.
모든 처리는 브라우저 안에서 이루어지며 파일은 외부로 전송되지 않습니다. 요구사항은 [PRD.md](PRD.md)를 참고하세요.

## 실행 방법

### 방법 1: 로컬 서버로 실행 (권장)

Node.js가 설치되어 있다면 이 폴더에서:

```
npx serve .
```

또는 Python이 설치되어 있다면:

```
python -m http.server 8000
```

브라우저에서 표시된 주소(예: http://localhost:3000, http://localhost:8000)를 엽니다.

### 방법 2: index.html 더블클릭

서버 없이 `index.html`을 바로 열 수 있습니다(Chromium 계열 브라우저에서 확인). `file://`에서는 브라우저가 Web Worker를 막기 때문에 PDF.js가 메인 스레드에서 렌더링하므로, 페이지가 많은 PDF는 썸네일 표시가 느릴 수 있습니다. 문제가 있으면 방법 1을 사용하세요.

### 방법 3: Streamlit으로 실행

```
pip install -r requirements.txt
streamlit run streamlit_app.py
```

`streamlit_app.py`는 `index.html`·`style.css`·`app.js`·`lib/`를 한 개의 HTML로 합쳐 Streamlit 화면 안에 띄웁니다. PDF 처리는 그대로 브라우저 안에서 이루어지며, 파일은 Streamlit 서버로 전송되지 않습니다.

## 웹에 배포 (Streamlit Community Cloud)

1. 이 폴더를 GitHub 저장소에 올립니다 (`lib/` 폴더 포함).
2. https://share.streamlit.io 에 GitHub 계정으로 로그인합니다.
3. **Create app** → 저장소·브랜치 선택, Main file path에 `streamlit_app.py` 입력 → **Deploy**.
4. 배포가 끝나면 `https://<앱이름>.streamlit.app` 주소로 접속할 수 있습니다.

## 파일 구성

```
index.html   화면 구조
style.css    스타일
app.js       앱 로직
streamlit_app.py  Streamlit 배포용 진입점
requirements.txt  Streamlit 배포 의존성
lib/         외부 라이브러리 (버전 고정, 로컬 포함)
  pdf.min.js, pdf.worker.min.js   PDF.js 3.11.174  — 썸네일 렌더링
  pdf-lib.min.js                  pdf-lib 1.17.1   — PDF 병합·저장
  Sortable.min.js                 SortableJS 1.15.2 — 드래그 정렬
```

## 라이브러리를 로컬에 포함한 이유

- 인터넷 연결 없이도 동작하며, CDN 장애나 차단의 영향을 받지 않습니다.
- PRD의 "외부 전송 없음" 요구사항에 맞춰, 앱 실행 중 외부 네트워크 요청이 전혀 발생하지 않습니다.
- PDF.js는 최신 4.x 대신 3.11.174를 사용합니다. 4.x는 ES 모듈 전용이라 `file://`로 열 수 없지만, 3.x는 일반 스크립트로 불러올 수 있어 더블클릭 실행이 가능합니다.
