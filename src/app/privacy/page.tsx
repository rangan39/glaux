import type { Metadata } from "next";
import { ExternalLinkIndicator } from "@/components/external-link-indicator";
import { HOME_PATH, PROJECT_SUPPORT_URL } from "@/lib/trust-navigation";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Sophon handles prompts, model files, browser storage, and network requests."
};

export default function PrivacyPolicy() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-sophon-canvas px-5 py-10 text-foreground sm:px-8 sm:py-16">
      <div aria-hidden="true" className="sophon-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="sophon-grid pointer-events-none absolute inset-0 opacity-45" />
      <article className="sophon-glass-strong relative mx-auto max-w-3xl rounded-3xl px-6 py-8 sm:px-10 sm:py-12">
        <a className="font-mono text-xs uppercase tracking-[0.14em] text-sophon-signal-soft underline decoration-sophon-signal/30 underline-offset-4 hover:text-sophon-signal" href={HOME_PATH}>← Back to Sophon</a>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-sophon-copy-primary sm:text-4xl">Privacy Policy</h1>
        <p className="sophon-type-metadata mt-2 font-mono uppercase tracking-[0.08em] text-sophon-copy-metadata" data-typography-role="metadata">Effective July 25, 2026</p>

        <div className="privacy-copy mt-8 space-y-8 text-sm leading-7 text-sophon-copy-body sm:text-base" data-typography-role="body">
          <section>
            <h2>Summary</h2>
            <p>Sophon runs selected Tiny Aya language models on your device. Your prompts and generated responses are processed locally in your browser and are not sent to Sophon, an inference service, Cohere, Hugging Face, or another third party.</p>
          </section>

          <section>
            <h2>Data Sophon handles locally</h2>
            <ul>
              <li><strong>Prompts and responses:</strong> kept in memory for the current page session so Sophon can maintain conversation context. They are not saved to browser storage. Resetting, reloading, or closing the page removes them.</li>
              <li><strong>Selected model:</strong> the identifier of the last model that became ready is stored in local browser storage so Sophon can restore it later.</li>
              <li><strong>Model data:</strong> the selected model&apos;s downloaded tensor weights, integrity checkpoints, resumable-download state, and verified packaged model files are stored in browser-private OPFS, IndexedDB, and Cache Storage.</li>
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
            <p>Downloaded or partially downloaded data for the selected model remains in browser-private storage until you switch models, delete it, the browser evicts it, you clear the extension&apos;s site data, or you uninstall the extension. Switching models removes all saved model files before starting the new download from scratch. Open <strong>Models</strong> and use the delete control to remove the current model&apos;s weights, checkpoints, and cached runtime files. To remove all Sophon data, delete the saved model, reset the conversation, and uninstall Sophon from <code>chrome://extensions</code> or clear its stored data through Chrome&apos;s site-data controls.</p>
          </section>

          <section>
            <h2>Permissions</h2>
            <p>The extension uses <code>unlimitedStorage</code> so the user-selected multi-gigabyte model can remain available locally. Its host access is limited to Hugging Face and related CDN hosts used for model-weight downloads. Sophon does not request browsing history, active-tab, page-content, clipboard, identity, location, camera, or microphone access.</p>
          </section>

          <section>
            <h2>Chrome Web Store Limited Use</h2>
            <p>Sophon&apos;s use of information received from Chrome APIs complies with the Chrome Web Store User Data Policy, including the Limited Use requirements. Data is used only to provide the extension&apos;s single purpose, is not transferred for unrelated purposes, is not used for advertising, and is not made available for human reading.</p>
          </section>

          <section>
            <h2>Changes and contact</h2>
            <p>Material changes will be posted on this page with a new effective date. Questions or privacy requests can be filed through the project&apos;s <a className="inline-flex items-center gap-1" href={PROJECT_SUPPORT_URL} rel="noreferrer" target="_blank">public support tracker <ExternalLinkIndicator /></a>. Because Sophon does not operate accounts or receive conversation data, the developer generally has no user record to retrieve or delete.</p>
          </section>

          <p className="sophon-type-metadata border-t border-sophon-glass-border pt-6 text-sophon-copy-metadata" data-typography-role="metadata">Sophon is an independent project and is not affiliated with, sponsored by, or endorsed by Cohere or Hugging Face.</p>
        </div>
      </article>
    </main>
  );
}
