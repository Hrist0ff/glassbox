import type { Metadata } from "next";
import { UnsavedPreview } from "@/components/UnsavedPreview";

/** Shows an explanation generated without a database; the content comes from this tab's sessionStorage. */
export const metadata: Metadata = {
  title: "Unsaved explanation",
  robots: { index: false, follow: false },
};

export default function PreviewPage() {
  return <UnsavedPreview />;
}
