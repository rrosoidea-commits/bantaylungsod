"""
Bantay Lungsod on Streamlit: the simulator, full screen, nothing else.

The simulator runs entirely in the visitor's browser (JavaScript + three.js). Streamlit only hosts the
page; the packed game (simulator.html, built from ../app by build_inline.py) fills the whole window.

Run locally:   streamlit run streamlit_app.py
"""
import os
import streamlit as st
import streamlit.components.v1 as components

HERE = os.path.dirname(os.path.abspath(__file__))
SIM = os.path.join(HERE, "simulator.html")

st.set_page_config(page_title="Bantay Lungsod: COVID-19 Outbreak Simulator", page_icon="🦠", layout="wide",
                   initial_sidebar_state="collapsed")

# Hide Streamlit's own page furniture and let the game's frame cover the entire browser window.
st.markdown("""<style>
  header[data-testid="stHeader"], [data-testid="stToolbar"], [data-testid="stDecoration"], [data-testid="stStatusWidget"],
  [data-testid="stSidebar"], [data-testid="stSidebarCollapsedControl"], [data-testid="collapsedControl"], footer, #MainMenu { display: none !important; }
  html, body, .stApp, [data-testid="stAppViewContainer"], [data-testid="stMain"] { background: #141a3c !important; overflow: hidden !important; }
  .block-container, [data-testid="stMainBlockContainer"] { padding: 0 !important; margin: 0 !important; max-width: 100% !important; }
  iframe { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important;
           border: 0 !important; border-radius: 0 !important; z-index: 999990; display: block; }
</style>""", unsafe_allow_html=True)


@st.cache_data(show_spinner=False)
def load_simulator(mtime: float) -> str:
    with open(SIM, encoding="utf-8") as f:
        return f.read()


if not os.path.exists(SIM):
    st.error("simulator.html is missing. Run `python build_inline.py` in this folder first (it packs ../app into one file).")
    st.stop()

components.html(load_simulator(os.path.getmtime(SIM)), height=900, scrolling=False)
