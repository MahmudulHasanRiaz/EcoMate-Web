import axios from "axios";

let lastRefreshAttempt = 0;
const REFRESH_COOLDOWN = 5000;

function getBaseUrl(): string {
  if (typeof window !== "undefined" && !window.location.hostname.includes("localhost")) {
    return "/api";
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api";
}

const apiClient = axios.create({
  baseURL: getBaseUrl(),
  withCredentials: true,
  timeout: 15000,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.request.use((config) => {
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const req = error.config;
    if (error.response?.status === 401 && !req._retry && req.url !== "/auth/refresh") {
      const now = Date.now();
      if (now - lastRefreshAttempt < REFRESH_COOLDOWN) {
        return Promise.reject(error);
      }
      lastRefreshAttempt = now;
      req._retry = true;
      try {
        const { data } = await axios.post(
          `${apiClient.defaults.baseURL}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        if (data.accessToken && typeof window !== "undefined") {
          localStorage.setItem("token", data.accessToken);
        }
        req.headers = {
          ...req.headers,
          Authorization: `Bearer ${data.accessToken}`,
        };
        return apiClient(req);
      } catch {
        if (typeof window !== "undefined") {
          localStorage.removeItem("token");
          window.dispatchEvent(new Event("auth:logout"));
        }
        return Promise.reject(error);
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
