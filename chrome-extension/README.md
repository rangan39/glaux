# Sophon Chrome extension

Build the unpacked Manifest V3 extension:

```bash
npm run build:extension
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `dist/chrome-extension`.

The toolbar action opens Sophon in a full extension tab. Model files are stored under the extension origin, so downloads from `localhost` or the hosted web app are not shared with the extension.
