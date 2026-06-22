interface EcoMateTracking {
  config: {
    pixelId: string;
    tiktokCode: string;
    currency: string;
  };
  track: (event: string, data?: Record<string, any>) => void;
}

interface Window {
  EcoMate?: EcoMateTracking;
}
