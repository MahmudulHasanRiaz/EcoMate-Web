"use client";

import { useState } from "react";
import apiClient from "@/lib/api-client";

const CV_ACCEPT = ".pdf,.doc,.docx";
const CV_MAX_BYTES = 5 * 1024 * 1024;

type Props = { slug: string };

export default function ApplyForm({ slug }: Props) {
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [coverLetter, setCoverLetter] = useState("");
  const [cv, setCv] = useState<File | null>(null);
  const [website, setWebsite] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function handleFile(file: File | null) {
    setError("");
    if (!file) {
      setCv(null);
      return;
    }
    if (file.size > CV_MAX_BYTES) {
      setError("CV must be 5 MB or smaller.");
      setCv(null);
      return;
    }
    setCv(file);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!fullName.trim() || !phone.trim() || !email.trim()) {
      setError("Please fill in your name, phone and email.");
      return;
    }
    if (!cv) {
      setError("Please attach your CV (PDF, DOC or DOCX, up to 5 MB).");
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.append("fullName", fullName.trim());
      form.append("phone", phone.trim());
      form.append("email", email.trim());
      form.append("coverLetter", coverLetter.trim());
      form.append("website", website);
      form.append("cv", cv);
      await apiClient.post(`/jobs/${encodeURIComponent(slug)}/apply`, form);
      setSubmitted(true);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { message?: string | string[] } } };
      const message = axiosErr?.response?.data?.message;
      setError(
        Array.isArray(message)
          ? message.join(", ")
          : message || "Something went wrong while submitting your application. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-[32px] border border-gray-100 bg-gray-50/50 p-8 text-center">
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Application received</h2>
        <p className="text-gray-500">
          Thank you for applying, {fullName.trim() || "candidate"}. We will get in touch if your profile fits the role.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[32px] border border-gray-100 bg-gray-50/50 p-8 space-y-5">
      <h2 className="text-2xl font-bold text-gray-900">Apply for this role</h2>

      <div className="grid gap-5 md:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-gray-500">Full Name *</span>
          <input
            type="text"
            required
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Your full name"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-brand-blue"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-gray-500">Phone *</span>
          <input
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="e.g. 01711-234567"
            className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-brand-blue"
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-gray-500">Email *</span>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-brand-blue"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-gray-500">Message / Cover Letter</span>
        <textarea
          rows={5}
          value={coverLetter}
          onChange={(e) => setCoverLetter(e.target.value)}
          placeholder="Tell us briefly why you fit this role."
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm outline-none focus:border-brand-blue"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-widest text-gray-500">CV (PDF, DOC or DOCX, up to 5 MB) *</span>
        <input
          type="file"
          accept={CV_ACCEPT}
          required
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm file:mr-4 file:rounded-full file:border-0 file:bg-black file:px-4 file:py-2 file:text-sm file:font-bold file:text-white"
        />
        {cv && <span className="mt-1 block text-xs text-gray-500">{cv.name} — {(cv.size / 1024).toFixed(0)} KB</span>}
      </label>

      {/* Honeypot — human visitors never fill this; bots do. */}
      <input
        type="text"
        name="website"
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        className="hidden"
      />

      {error && <p className="text-sm font-medium text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-full bg-black px-12 py-4 font-bold text-white shadow-xl transition-transform hover:scale-105 disabled:opacity-50"
      >
        {submitting ? "Submitting…" : "Submit Application"}
      </button>
    </form>
  );
}
