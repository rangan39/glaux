const chromeExtensionBuild = process.env.NEXT_PUBLIC_SOPHON_CHROME_EXTENSION === "1";

export const HOME_PATH = chromeExtensionBuild ? "/index.html" : "/";
export const PRIVACY_PATH = chromeExtensionBuild ? "/privacy.html" : "/privacy";

export const COHERE_LABS_AUP_URL = "https://docs.cohere.com/docs/cohere-labs-acceptable-use-policy";
export const PROJECT_SUPPORT_URL = "https://github.com/rangan39/sophon/issues";
export const TINY_AYA_LICENSE_URL = "https://creativecommons.org/licenses/by-nc/4.0/";
