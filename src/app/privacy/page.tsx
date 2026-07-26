import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Sophon handles prompts, model files, browser storage, and network requests."
};

const HOME_PATH = process.env.NEXT_PUBLIC_SOPHON_CHROME_EXTENSION === "1" ? "/index.html" : "/";

export default function PrivacyPolicy() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-sophon-canvas px-5 py-10 text-foreground sm:px-8 sm:py-16">
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-45" />
      <article className="sophon-glass-strong relative mx-auto max-w-3xl rounded-3xl px-6 py-8 sm:px-10 sm:py-12">
        <a className="font-mono text-xs uppercase tracking-[0.14em] text-[#ffb4a4] underline decoration-white/20 underline-offset-4 hover:text-sophon-signal-bright" href={HOME_PATH}>← Back to Sophon</a>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-white sm:text-4xl">Privacy Policy</h1>
        <p className="mt-2 font-mono text-xs uppercase tracking-[0.12em] text-white/45">Effective July 25, 2026</p>

        <div className="privacy-copy mt-8 space-y-8 text-sm leading-7 text-white/70 sm:text-base">
          <section>
            <h2>Summary</h2>
            <p>Sophon runs selected Tiny Aya language models on your device. Your prompts and generated responses are processed locally in your browser and are not sent to Sophon, an inference service, Cohere, Hugging Face, or another third party.</p>
          </section>

          <section>
            <h2>Data Sophon handles locally</h2>
            <ul>
              <li><strong>Prompts and responses:</strong> kept in memory for the current page session so Sophon can maintain conversation context. They are not saved to browser storage. Resetting, reloading, or closing the page removes them.</li>
              <li><strong>Selected model:</strong> the identifier of the last model that became ready is stored in local browser storage so Sophon can restore it later.</li>
              <li><strong>Model data:</strong> downloaded tensor weights, integrity checkpoints, resumable-download state, and verified packaged model files are stored in browser-private OPFS, IndexedDB, and Cache Storage.</li>
              <li><strong>Offline imports:</strong> imported model bytes enter the same browser-private model cache. Sophon does not copy or retain the complete source <code>.sophon-model</code> file.</li>
              <li><strong>Runtime measurements:</strong> token counts and performance measurements such as time to first token are calculated and displayed locally. They are not transmitted.</li>
            </ul>
          </section>

          <section>
            <h2>Network requests</h2>
            <p>Sophon contacts version-pinned Hugging Face and CDN endpoints over HTTPS only after you approve a model download. Those requests retrieve external tensor-weight data. Application code, WebAssembly, ONNX graphs, model configuration, generation configuration, and tokenizer files are packaged with Sophon.</p>
            <p>Hugging Face and its delivery providers may receive ordinary request metadata such as your IP address, user agent, requested file, timing, and transfer size. Their handling of that metadata is governed by their own policies. Sophon does not add prompts, responses, account identifiers, analytics identifiers, or advertising identifiers to model-download requests.</p>
          </section>

          <section>
            <h2>Accounts, analytics, advertising, and sharing</h2>
            <p>Sophon has no user accounts, cloud inference, analytics, advertising, telemetry upload, tracking pixels, sale of data, or human review of conversations. The developer cannot access locally processed prompts, responses, model selections, or runtime measurements.</p>
          </section>

          <section>
            <h2>Retention and deletion</h2>
            <p>Conversation content lasts only for the current page session. Use <strong>Reset conversation</strong> to remove it immediately.</p>
            <p>Downloaded or partially downloaded model data remains in browser-private storage until you delete it, the browser evicts it, you clear the extension&apos;s site data, or you uninstall the extension. Open <strong>Models</strong> and choose the delete control beside a model to remove that model&apos;s weights, checkpoints, and cached runtime files. To remove all Sophon data, delete each saved model, reset the conversation, and uninstall Sophon from <code>chrome://extensions</code> or clear its stored data through Chrome&apos;s site-data controls.</p>
          </section>

          <section>
            <h2>Permissions</h2>
            <p>The extension uses <code>unlimitedStorage</code> so user-selected multi-gigabyte model data can remain available locally. Its host access is limited to Hugging Face and related CDN hosts used for model-weight downloads. Sophon does not request browsing history, active-tab, page-content, clipboard, identity, location, camera, or microphone access.</p>
          </section>

          <section>
            <h2>Chrome Web Store Limited Use</h2>
            <p>Sophon&apos;s use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the extension&apos;s single purpose, is not transferred for unrelated purposes, is not used for advertising, and is not made available for human reading.</p>
          </section>

          <section>
            <h2>Changes and contact</h2>
            <p>Material changes will be posted on this page with a new effective date. Questions or privacy requests can be filed through the project&apos;s <a href="https://github.com/rangan39/sophon/issues" rel="noreferrer" target="_blank">public support tracker</a>. Because Sophon does not operate accounts or receive conversation data, the developer generally has no user record to retrieve or delete.</p>
          </section>

          <p className="border-t border-white/10 pt-6 text-xs text-white/45">Sophon is an independent project and is not affiliated with, sponsored by, or endorsed by Cohere or Hugging Face.</p>
        </div>
      </article>
    </main>
  );
}
