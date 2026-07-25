const APP_PAGE = "index.html";

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL(APP_PAGE) });
});
