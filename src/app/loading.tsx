import { MoonStar } from "lucide-react";

export default function Loading() {
  return (
    <main aria-busy="true" className="relative flex h-svh items-center justify-center overflow-hidden bg-glaux-canvas p-6 text-foreground" role="status">
      <div aria-hidden="true" className="glaux-noise pointer-events-none absolute inset-0" />
      <div aria-hidden="true" className="glaux-grid pointer-events-none absolute inset-0 opacity-45" />
      <div className="glaux-glass-strong relative flex flex-col items-center rounded-2xl px-8 py-7">
        <div aria-hidden="true" className="grid size-14 place-items-center rounded-xl border border-glaux-signal-bright/60 bg-gradient-to-br from-glaux-signal-bright to-glaux-signal text-[#061225] shadow-[0_0_30px_rgb(0_140_255/.24)]"><MoonStar className="size-7 stroke-[1.8]" /></div>
        <p className="glaux-type-status mt-4 font-mono uppercase tracking-[0.1em] text-glaux-copy-metadata" data-typography-role="status">Loading inference console</p>
      </div>
    </main>
  );
}
