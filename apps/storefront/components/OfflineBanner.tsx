"use client";

import { WifiOff } from "lucide-react";
import useOnlineStatus from "@/hooks/useOnlineStatus";

export default function OfflineBanner() {
  const online = useOnlineStatus();

  if (online) return null;

  return (
    <div
      className="fixed top-0 left-0 right-0 z-[99999] bg-amber-500 px-4 py-2 text-center text-sm font-medium text-white"
      role="alert"
    >
      <WifiOff className="inline-block mr-2 h-4 w-4" />
      You are offline — images may not load
    </div>
  );
}
