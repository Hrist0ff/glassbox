import type { Metadata } from "next";
import { SavedExplanation } from "@/components/SavedExplanation";
import { generationMode } from "@/lib/env";

/** Another example made for one step of a saved explanation; read from this browser's localStorage. */
export const metadata: Metadata = {
  title: "Example",
  robots: { index: false, follow: false },
};

export default async function ExamplePage({ params }: PageProps<"/concept/[id]/example/[supplementId]">) {
  const { id, supplementId } = await params;
  return <SavedExplanation id={id} exampleId={supplementId} exploreAvailable={generationMode().mode === "live"} />;
}
