const chromeExtensionBuild = process.env.NEXT_PUBLIC_GLAUX_CHROME_EXTENSION === "1";

export const HOME_PATH = chromeExtensionBuild ? "/index.html" : "/";
export const PRIVACY_PATH = chromeExtensionBuild ? "/privacy.html" : "/privacy";

export const ONNX_COMMUNITY_URL = "https://huggingface.co/onnx-community";
export const PROJECT_REPOSITORY_URL = "https://github.com/rangan39/glaux";
export const PROJECT_SUPPORT_URL = "https://github.com/rangan39/glaux/issues";
