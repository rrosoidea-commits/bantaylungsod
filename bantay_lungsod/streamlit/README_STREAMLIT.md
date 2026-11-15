# Bantay Lungsod on Streamlit

The simulator is a browser app (JavaScript + three.js). Streamlit only hosts it: the game fills the whole
browser window, with Streamlit's own bars and sidebar hidden. Nothing in `app/` is changed.

```
project/
├── .streamlit/config.toml        colours and minimal toolbar (Streamlit Cloud reads it from the repo root)
├── app/                          the simulator, unchanged
├── py/prepare_data.py            data cleaning script (unchanged)
└── streamlit/
    ├── streamlit_app.py          entry point: shows the simulator full screen
    ├── build_inline.py           packs app/ into one file
    ├── simulator.html            the packed simulator (built; commit it)
    └── requirements.txt
```

## Run it on your computer

```bash
pip install -r streamlit/requirements.txt
streamlit run streamlit/streamlit_app.py
```

## Deploy on Streamlit Community Cloud (free)

1. Put the project in a GitHub repository with the layout above. Leave out the large raw CSV files in
   `data/` (one is about 98 MB; GitHub refuses files over 100 MB and the app does not need them).
2. Go to <https://share.streamlit.io>, sign in with GitHub, and click **Create app**.
3. Choose the repository and branch, and set **Main file path** to `streamlit/streamlit_app.py`.
4. Click **Deploy**. The first start takes a minute or two.

## When you change the simulator

`simulator.html` is a packed copy of `app/`. After editing anything in `app/`, rebuild it and commit it:

```bash
python streamlit/build_inline.py
```

## Notes

* three.js still loads from the cdnjs CDN, exactly as in `app/index.html`, so visitors need internet access.
* The game fills the browser window. Press F11 for true full screen.
* On Streamlit Community Cloud the app owner also sees a small "Manage app" button in the bottom-right corner;
  visitors do not.
* Best grades and preferences are saved in the visitor's browser, as in the stand-alone version.
