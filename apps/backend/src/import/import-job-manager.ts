import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

export interface ImportJob {
  id: string;
  type: 'products' | 'orders';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress: {
    total: number;
    processed: number;
  };
  summary: any;
  errors: any[];
  error?: string;
  startedAt: Date;
  completedAt?: Date;
}

@Injectable()
export class ImportJobManager {
  private jobs = new Map<string, ImportJob>();

  createJob(type: 'products' | 'orders', total: number): ImportJob {
    const id = randomUUID();
    const job: ImportJob = {
      id,
      type,
      status: 'pending',
      progress: {
        total,
        processed: 0,
      },
      summary: null,
      errors: [],
      startedAt: new Date(),
    };
    this.jobs.set(id, job);
    return job;
  }

  getJob(id: string): ImportJob | undefined {
    return this.jobs.get(id);
  }

  updateProgress(id: string, processed: number) {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'processing';
      job.progress.processed = processed;
    }
  }

  completeJob(id: string, summary: any, errors: any[]) {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'completed';
      job.summary = summary;
      job.errors = errors;
      job.completedAt = new Date();
    }
  }

  failJob(id: string, error: string, errors: any[] = []) {
    const job = this.jobs.get(id);
    if (job) {
      job.status = 'failed';
      job.error = error;
      job.errors = errors;
      job.completedAt = new Date();
    }
  }
}
