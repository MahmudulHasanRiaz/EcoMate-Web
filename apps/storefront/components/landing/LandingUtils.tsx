"use client";

import { useState, useEffect } from "react";

export function CountdownTimer({ targetDate }: { targetDate: string }) {
  const [timeLeft, setTimeLeft] = useState("");

  useEffect(() => {
    const target = new Date(targetDate).getTime();
    const tick = () => {
      const now = Date.now();
      const diff = target - now;
      if (diff <= 0) { setTimeLeft("Expired"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setTimeLeft(`${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [targetDate]);

  if (!timeLeft || timeLeft === "Expired") return null;

  return (
    <div className="inline-flex items-center gap-1.5 bg-black/30 backdrop-blur-sm rounded-full px-4 py-2 text-white font-mono text-lg font-bold tracking-wider">
      <span className="text-xs font-sans font-normal opacity-80 mr-1">Ends in</span>
      {timeLeft}
    </div>
  );
}

export function StockIndicator({ count }: { count: number }) {
  if (!count || count <= 0) return null;
  return (
    <div className="inline-flex items-center gap-1.5 bg-red-500/20 backdrop-blur-sm rounded-full px-3 py-1 text-red-200 text-sm">
      <span className="relative flex h-2 w-2">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
      </span>
      Only {count} left in stock
    </div>
  );
}
