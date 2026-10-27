"""PDF 페이지 정리 — Streamlit 배포용 진입점.

index.html / style.css / app.js / lib/*.js 를 한 개의 HTML로 합쳐 Streamlit 화면 안(iframe)에 띄운다.
PDF 업로드·렌더링·편집·저장은 모두 사용자 브라우저 안에서 처리되며, 파일은 Streamlit 서버로 전송되지 않는다.

실행: streamlit run streamlit_app.py
"""

from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components

ROOT = Path(__file__).parent
SCRIPTS = ["lib/pdf.min.js", "lib/pdf-lib.min.js", "lib/Sortable.min.js", "app.js"]
APP_HEIGHT = 900  # 앱 화면(iframe) 높이(px). 안에서 스크롤된다

st.set_page_config(page_title="PDF 페이지 정리", page_icon="📄", layout="wide")


def read_text(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def inline_js(path: str) -> str:
    # 스크립트 안의 "</script"가 HTML 태그로 해석되지 않도록 이스케이프
    return read_text(path).replace("</script", "<\\/script")


def replace_once(html: str, old: str, new: str) -> str:
    if html.count(old) != 1:
        raise RuntimeError(f"index.html에서 다음 부분을 찾지 못했습니다: {old}")
    return html.replace(old, new)


@st.cache_resource
def build_html() -> str:
    html = read_text("index.html")
    html = replace_once(
        html,
        '<link rel="stylesheet" href="style.css">',
        f"<style>\n{read_text('style.css')}\n</style>",
    )

    # PDF.js worker는 파일 주소가 필요하므로 Blob URL로 만들어 app.js에 넘긴다
    worker = (
        f'<script id="pdf-worker-src" type="text/plain">{inline_js("lib/pdf.worker.min.js")}</script>\n'
        "<script>window.PDF_WORKER_SRC = URL.createObjectURL(new Blob("
        "[document.getElementById('pdf-worker-src').textContent], { type: 'text/javascript' }));</script>"
    )
    for i, src in enumerate(SCRIPTS):
        inline = f"<script>\n{inline_js(src)}\n</script>"
        if i == 0:
            inline = f"{worker}\n{inline}"
        html = replace_once(html, f'<script src="{src}"></script>', inline)
    return html


# Streamlit 기본 여백·메뉴를 줄여 앱이 화면을 넓게 쓰도록 한다
st.markdown(
    """
    <style>
      header[data-testid="stHeader"] { display: none; }
      .block-container { padding: 0.5rem 0.5rem 0 !important; max-width: 100% !important; }
      footer { display: none; }
    </style>
    """,
    unsafe_allow_html=True,
)

components.html(build_html(), height=APP_HEIGHT, scrolling=True)
