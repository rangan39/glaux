import type { Metadata } from "next";
import { ExternalLinkIndicator } from "@/components/external-link-indicator";
import { HOME_PATH, PROJECT_SUPPORT_URL } from "@/lib/trust-navigation";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How Glaux handles prompts, model files, browser storage, and network requests."
};

export default function PrivacyPolicy() {
  return (
    <main className="relative min-h-svh overflow-hidden bg-glaux-canvas px-5 py-10 text-foreground sm:px-8 sm:py-16">
      <div aria-hidden="true" className="glaux-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="glaux-grid pointer-events-none absolute inset-0 opacity-45" />
      <article className="glaux-glass-strong relative mx-auto max-w-3xl rounded-3xl px-6 py-8 sm:px-10 sm:py-12">
        <a className="font-mono text-xs uppercase tracking-[0.14em] text-glaux-signal-soft underline decoration-glaux-signal/30 underline-offset-4 hover:text-glaux-signal" href={HOME_PATH}>← Back to Glaux</a>
        <h1 className="mt-6 text-3xl font-semibold tracking-tight text-glaux-copy-primary sm:text-4xl">Privacy Policy</h1>
        <p className="glaux-type-metadata mt-2 font-mono uppercase tracking-[0.08em] text-glaux-copy-metadata" data-typography-role="metadata">Effective July 25, 2026</p>

        <div className="privacy-copy mt-8 space-y-8 text-sm leading-7 text-glaux-copy-body sm:text-base" data-typography-role="body">
          <section>
            <h2>Summary</h2>
            <p>Glaux runs compatible Hugging Face ONNX Community language models on your device. Your prompts and generated responses are processed locally in your browser and are not sent to Glaux, an inference service, Hugging Face, or another third party.</p>
          </section>

          <section>
            <h2>Data Glaux handles locally</h2>
            <ul>
              <li><strong>Prompts and responses:</strong> kept in memory for the current page session so Glaux can maintain conversation context. They are not saved to browser storage. Resetting, reloading, or closing the page removes them.</li>
              <li><strong>Model catalog and selection:</strong> model search results, immutable repository descriptors, and the identifier of the last ready model are stored in local browser storage so Glaux can restore the browser session.</li>
              <li><strong>Model data:</strong> the selected model&apos;s downloaded tensor weights, integrity checkpoints, resumable-download state, and verified packaged model files are stored in browser-managed OPFS, IndexedDB, and Cache Storage.</li>
              <li><strong>Runtime measurements:</strong> token counts and performance measurements such as time to first token are calculated and displayed locally. They are not transmitted.</li>
            </ul>
          </section>

          <section>
            <h2>Network requests</h2>
            <p>Glaux queries Hugging Face when you search or open the popular-model view. After you approve a download, it retrieves the selected model’s ONNX graph, weights, configuration, generation settings, and tokenizer files from an immutable repository revision over HTTPS. The application runtime itself is packaged with Glaux.</p>
            <p>Hugging Face and its delivery providers may receive ordinary request metadata such as your IP address, user agent, requested file, timing, and transfer size. Their handling of that metadata is governed by their own policies. Glaux does not add prompts, responses, account identifiers, analytics identifiers, or advertising identifiers to model-download requests.</p>
          </section>

          <section>
            <h2>Accounts, analytics, advertising, and sharing</h2>
            <p>Glaux has no user accounts, cloud inference, analytics, advertising, telemetry upload, tracking pixels, sale of data, or human review of conversations. The developer cannot access locally processed prompts, responses, model selections, or runtime measurements.</p>
          </section>

          <section>
            <h2>Retention and deletion</h2>
            <p>Conversation content lasts only for the current page session. Use <strong>Reset conversation</strong> to remove it immediately.</p>
            <p>Downloaded or partially downloaded data for the selected model remains in browser storage until you switch models, delete it, the browser evicts it, or you clear Glaux&apos;s site data. Switching models removes all saved model files before starting the new download from scratch. If Glaux detects multiple model downloads left by an older version, it removes all of them before restoring a model. Open <strong>Models</strong> and use the delete control to remove the current model&apos;s weights, checkpoints, and cached runtime files. To remove all Glaux data, delete the saved model, reset the conversation, and clear Glaux&apos;s stored site data through your browser settings.</p>
          </section>

          <section>
            <h2>Browser capabilities</h2>
            <p>Glaux uses browser storage, Web Workers, and WebGPU to download and run a model locally. Network access is limited to loading Glaux and requesting public model metadata and files from Hugging Face and its delivery hosts. Glaux does not request access to browsing history, other pages, the clipboard, identity, location, camera, or microphone.</p>
          </section>

          <section>
            <h2>Changes and contact</h2>
            <p>Material changes will be posted on this page with a new effective date. Questions or privacy requests can be filed through the project&apos;s <a className="inline-flex items-center gap-1" href={PROJECT_SUPPORT_URL} rel="noreferrer" target="_blank">public support tracker <ExternalLinkIndicator /></a>. Because Glaux does not operate accounts or receive conversation data, the developer generally has no user record to retrieve or delete.</p>
          </section>

          <p className="glaux-type-metadata border-t border-glaux-glass-border pt-6 text-glaux-copy-metadata" data-typography-role="metadata">Glaux is an independent project and is not affiliated with, sponsored by, or endorsed by Hugging Face or community model authors.</p>
        </div>
      </article>
    </main>
  );
}
