import { serverFetch } from "../api-server";

export interface PublicJobPosting {
  id: string;
  slug: string;
  title: string;
  department?: { id: string; name: string; slug: string } | null;
  designation?: { id: string; name: string; slug: string } | null;
  location: string;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryDisplay: string | null;
  description: string;
  requirements: string | null;
  responsibilities: string | null;
  benefits: string[] | null;
  deadline: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface JobsListResponse {
  data: PublicJobPosting[];
  meta: { total: number; page: number; perPage: number; totalPages: number };
}

export interface JobsQuery {
  department?: string;
  type?: string;
  location?: string;
  page?: number;
  perPage?: number;
}

/** Published roles only — the backend filters to PUBLISHED + unexpired. */
export async function getJobs(query?: JobsQuery): Promise<JobsListResponse> {
  const params = new URLSearchParams();
  if (query?.department) params.set('department', query.department);
  if (query?.type) params.set('type', query.type);
  if (query?.location) params.set('location', query.location);
  if (query?.page) params.set('page', String(query.page));
  if (query?.perPage) params.set('perPage', String(query.perPage));
  const qs = params.toString();
  return serverFetch<JobsListResponse>(`/jobs${qs ? `?${qs}` : ''}`, {
    next: { revalidate: 300 },
  });
}

export async function getJobBySlug(slug: string): Promise<PublicJobPosting> {
  return serverFetch<PublicJobPosting>(`/jobs/${encodeURIComponent(slug)}`, {
    next: { revalidate: 300 },
  });
}

export function formatJobSalary(job: PublicJobPosting): string | null {
  if (job.salaryDisplay) return job.salaryDisplay;
  if (job.salaryMin !== null && job.salaryMax !== null) {
    return `৳${job.salaryMin.toLocaleString()}–${job.salaryMax.toLocaleString()}`;
  }
  if (job.salaryMin !== null) return `৳${job.salaryMin.toLocaleString()}+`;
  if (job.salaryMax !== null) return `Up to ৳${job.salaryMax.toLocaleString()}`;
  return null;
}
