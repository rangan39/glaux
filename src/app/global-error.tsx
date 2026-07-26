"use client";

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main className="flex min-h-svh items-center justify-center bg-[radial-gradient(circle_at_18%_0%,rgb(0_184_255/.17),transparent_34rem),linear-gradient(145deg,#ffffff,#f7fbff_52%,#edf7ff)] p-6 text-[#071426]">
          <section className="w-full max-w-md rounded-2xl border border-[#a8c2d8]/60 bg-white/90 p-6 shadow-[inset_0_1px_0_rgb(255_255_255/.92),0_24px_70px_rgb(26_83_125/.16)] backdrop-blur-2xl" role="alert">
            <p aria-hidden="true" className="font-serif text-3xl text-[#006bd6]">Δ</p>
            <h1 className="mt-3 font-mono text-sm font-semibold uppercase tracking-[0.12em]">Sophon encountered a critical error</h1>
            <p className="mt-2 text-sm leading-6 text-[#24384f]">Reload the application shell to reconnect to the local runtime.</p>
            <button className="mt-5 h-10 rounded-xl bg-[#008cff] px-4 text-sm font-medium text-[#061225] shadow-[0_0_22px_rgb(0_140_255/.28)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#008cff]" onClick={reset} type="button">Retry</button>
          </section>
        </main>
      </body>
    </html>
  );
}
