import { Suspense } from "react";
import ArchivePageClient from "./ArchivePageClient";

export default function ProductsPage() {
  return (
    <Suspense>
      <ArchivePageClient />
    </Suspense>
  );
}
