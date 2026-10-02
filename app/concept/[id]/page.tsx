import type { Metadata } from "next";
import { SavedExplanation } from "@/components/SavedExplanation";

/** An explanation generated in this browser; its content comes from the browser's localStorage. */
export const metadata: Metadata = {
  title: "Saved explanation",
  robots: { index: false, follow: false },
};

export default async function ConceptPage({ params }: PageProps<"/concept/[id]">) {
  const { id } = await params;
  return <SavedExplanation id={id} />;
}
