import axios from "axios";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000/api",
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

apiClient.interceptors.response.use(
  (res) => res,
  async (error) => {
    const req = error.config;
    if (error.response?.status === 401 && !req._retry) {
      req._retry = true;
      try {
        await axios.post(
          `${apiClient.defaults.baseURL}/auth/refresh`,
          {},
          { withCredentials: true },
        );
        return apiClient(req);
      } catch {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("auth:logout"));
        }
      }
    }
    return Promise.reject(error);
  },
);

export default apiClient;
