import { notFound } from "next/navigation";

import { RuntimeCapabilitiesProbe } from "./runtime-capabilities";

export default function RuntimeCapabilitiesProductTestPage() {
  if (process.env.NEXT_PUBLIC_GLAUX_PRODUCT_TESTING !== "1") notFound();

  return (
    <main>
      <h1>Runtime capabilities product test</h1>
      <RuntimeCapabilitiesProbe />
    </main>
  );
}
