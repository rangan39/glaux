# Chrome Web Store graphics

Generated assets:

- `promo-small-440x280.png` — required small promotional tile
- `marquee-1400x560.png` — optional marquee promotional image
- `screenshots/*.png` — four actual 1280×800 extension views
- `dist/chrome-extension/icons/icon-128.png` — required extension icon with 96×96 artwork and 16px transparent padding on every side

Regenerate after UI or identity changes:

```bash
npm run build:extension
npm run assets:extension
```

The screenshot script launches the built unpacked extension in a clean Chromium profile. Do not retouch screenshots in a way that misrepresents the submitted extension.
