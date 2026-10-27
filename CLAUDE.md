# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트

"PDF 페이지 정리"는 브라우저에서만 동작하는 PDF 페이지 편집기입니다. 메인 PDF의 페이지를 삭제·재배치·회전하고, 첨부 PDF의 페이지를 복사해 넣은 뒤 하나의 PDF로 저장합니다.
- 프레임워크와 빌드 단계 없이 Vanilla JS로 작성했습니다.
- PDF 처리는 모두 사용자 브라우저 안에서 이루어지며 서버로 아무것도 보내지 않습니다. PRD 요구사항이므로 Streamlit 래퍼에서도 이 원칙을 유지해야 합니다.

문서와 규칙:
- 요구사항의 기준은 `PRD.md`입니다.
  - 요구사항 ID(F-, A-, P-, E-, S-, D-)마다 "상태" 열이 있습니다.
  - 8장은 알려진 문제, 9장은 마일스톤입니다.
  - 동작이 바뀌면 이 내용도 함께 갱신합니다.
- `PROMPTS.md`에는 단계별 개발 프롬프트와 진행 상황 표가 있습니다. 1~4단계(M1~M4)는 모두 완료했습니다. 남은 일은 P2 기능(PRD 3장 ⬜)과 낮음 문제(PRD 8장)입니다.
- UI 문구, 코드 주석, 문서, 커밋 메시지는 모두 한국어로 씁니다.

## 명령어

빌드, 린트, 테스트 도구는 없습니다.

```
python -m http.server 8000          # 권장 실행 방법 (또는 npx serve .)
streamlit run streamlit_app.py      # Streamlit 래퍼 (pip install -r requirements.txt)
node --check app.js                 # 수정 후 문법 확인
```

`index.html`을 직접 열어도(`file://`) Chromium에서는 동작합니다. 다만 PDF.js가 실제 worker 없이 렌더링해서 느립니다.

동작 확인은 Playwright로 앱을 직접 조작해서 해 왔습니다. `app.js` 최상위의 `const`·`function` 선언은 `page.evaluate`에서 바로 접근할 수 있으므로 다음 방법이 유용합니다.
- 상태를 직접 읽기: `state.pages`, `thumbCache`, `exportFileName()`
- 실제 다운로드 없이 저장 결과 확인: `window.downloadBlob = (blob, name) => …`로 바꿔 놓고 `#btn-save`를 클릭합니다. 받은 blob을 `pdfjsLib.getDocument`로 열어 페이지 순서·텍스트·회전을 검사합니다.
- 저장 데이터는 origin별로 남습니다(IndexedDB `pdf-page-editor`, localStorage `pdf-page-editor:state`). 깨끗한 상태가 필요하면 새 브라우저 컨텍스트를 사용합니다.

## 구조

파일 구성은 다음과 같습니다.
- `index.html`: 화면 구조와 대화상자
- `style.css`: 스타일
- `app.js`: 모든 로직
- `lib/`: 버전을 고정해 로컬에 포함한 라이브러리
  - PDF.js 3.11.174, pdf-lib 1.17.1, SortableJS 1.15.2
  - CDN을 쓰지 않는 이유: 오프라인 동작, 외부 요청 없음
  - PDF.js를 3.x로 유지하는 이유: 4.x는 ES 모듈 전용이라 `file://` 실행이 깨짐

### 상태와 렌더링 (`app.js`)
- `state`의 구성
  - `files`: Map fileId → `{name, pageCount, color, data: ArrayBuffer}`
  - `mainFileId`, `attachmentIds`
  - `pages`: `[{uid, fileId, pageIndex, rotation}]`. 배열 순서가 곧 저장 순서
- 화면 전용 상태(저장하지 않음): 첨부 선택 `selection`(`"fileId:pageIndex"`), 메인 선택 `mainSelection`(페이지 uid), `undoHistory`, `collapsedAttach`
- **`state.pages`와 그 안의 페이지 객체를 제자리에서 바꾸지 않습니다.**
  - 실행 취소 기록은 `pages` 배열의 스냅샷이고, 스냅샷끼리 페이지 객체를 공유합니다.
  - 순서를 바꿀 때는 항상 새 배열을 할당합니다(`setPageOrder`, `insertAttachPages`).
  - 필드를 바꿀 때는 페이지 객체도 새로 만듭니다(`rotatePages`).
- `render()`는 메인 그리드와 첨부 패널 전체를 state로부터 다시 그린 뒤 `scheduleSave()`를 호출합니다. 모든 변경은 이 함수를 거칩니다.
- ◀ ▶ 버튼, 번호 입력, 선택 일괄 이동은 `animateReorder`로 처리합니다. FLIP 애니메이션과 강조 표시를 보여 주고, 포커스를 같은 버튼에 남깁니다.
- PDF.js는 넘겨받은 버퍼를 worker로 보내며 비웁니다(detach). PDF.js와 pdf-lib에는 항상 `data.slice(0)`을 넘기고, 원본은 `state.files`에만 둡니다.
- `pruneFiles()`는 쓰지 않는 파일을 정리합니다.
  - 정리 대상: 메인 PDF, 첨부 목록, `pages`, 실행 취소/다시 실행 스냅샷 어디에서도 쓰지 않는 파일
  - 정리 범위: 메모리, IndexedDB, PDF.js 문서, 썸네일
  - 파일이 고아가 될 수 있는 작업 뒤에는 반드시 호출합니다.

### 썸네일
- canvas는 `thumbCache`에 캐시하고, 화면에 들어온 것만 그립니다(IntersectionObserver → 순차 렌더링 큐 `renderThumbnail`).
- 캐시 키 형식
  - 메인 카드: `m:<페이지uid>:<회전>`
  - 첨부: `a:<fileId>:<pageIndex>`
- 메인 키에는 fileId가 없으므로, `pruneFiles`는 살아 있는 페이지 uid를 기준으로 정리합니다.

### 드래그 앤 드롭 (SortableJS)
- 메인 그리드는 `put: true`, 첨부 그리드는 `pull: 'clone', put: false`입니다.
- SortableJS가 DOM을 먼저 옮기면, 핸들러가 그 결과를 새 `state.pages`로 바꾸고 다시 그립니다. `onAdd`에서는 끌려온 복제 DOM을 지웁니다.
- 여러 페이지를 선택한 상태에서 선택된 카드를 끌면 선택한 페이지 전체가 함께 이동합니다.
- `onUpdate`·`onAdd` 안에서 다시 그리면 Sortable의 `onEnd`가 불리지 않을 수 있습니다. 그래서 드래그용 CSS 클래스(`dragging-attach`, `dragging-multi`)는 렌더링 함수에서도 끕니다.

### 저장 (새로고침 대응)
- IndexedDB `files` 저장소에는 원본 PDF를 업로드할 때 저장하고, `meta` 저장소에는 작업 상태를 300ms 지연으로 묶어 저장합니다.
- 같은 meta를 바뀔 때마다 localStorage에도 동기적으로 저장합니다.
  - 이유: 페이지가 닫히기 직전에 시작한 IndexedDB 쓰기는 끝나지 못할 수 있습니다.
  - `loadState`는 `updatedAt`이 더 최근인 쪽을 사용합니다.
- IndexedDB를 쓸 수 없거나 용량이 부족하면 배너로 안내하고 편집은 계속할 수 있습니다.

### 업로드 검사
`loadPdfFile`은 PDF.js와 pdf-lib(`ignoreEncryption: true`) 둘 다로 파일을 열어 보고, 암호화된 파일을 거부합니다. 인쇄·복사만 제한된 PDF는 화면에는 정상으로 보이지만 pdf-lib로 저장할 수 없기 때문에 함께 거부합니다. 업로드에서 받아들인 파일은 반드시 저장도 가능해야 합니다.

### Streamlit 래퍼 (`streamlit_app.py`)
- `index.html`을 바탕으로 HTML 하나를 만들어 `components.html`의 iframe으로 띄웁니다. `style.css`, `lib/` 스크립트, `app.js`는 모두 인라인으로 넣습니다.
- `replace_once`가 `<link rel="stylesheet" href="style.css">`와 `<script src="…"></script>` 태그를 글자 그대로 찾아 바꿉니다. `index.html`의 스크립트 이름·순서를 바꾸거나 스크립트를 추가하면 `SCRIPTS` 목록도 함께 수정해야 합니다.
- PDF.js worker는 텍스트로 넣은 뒤 Blob URL로 만들어 `window.PDF_WORKER_SRC`로 넘깁니다(`app.js` 맨 위에서 읽음).
- 인라인 JS 안의 `</script`는 이스케이프합니다.
- `build_html`은 `@st.cache_resource`로 캐시되므로, 프런트엔드 파일을 수정하면 Streamlit을 다시 시작해야 반영됩니다.
- 배포 대상은 Streamlit Community Cloud입니다(절차는 README 참고).
