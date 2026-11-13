"use client";

import { useState } from "react";
import { Send, CheckCircle } from "lucide-react";
import { submitSupportEnquiry } from "@/lib/api/support-enquiries";

/**
 * Support enquiry form (D9). Posts to the public `POST /support-enquiries`
 * endpoint; enquiries land in the admin inbox with status NEW. The
 * `website` field is a honeypot — hidden from real visitors, filled by
 * bots; the backend accepts-and-drops those submissions.
 */
export default function SupportEnquiryForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [orderId, setOrderId] = useState("");
  const [website, setWebsite] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);

  if (sent) {
    return (
      <div className="bg-white rounded-2xl p-8 border border-gray-100 text-center">
        <CheckCircle size={40} className="text-brand-blue mx-auto mb-4" />
        <h3 className="font-bold text-gray-800 text-xl mb-2">Message sent</h3>
        <p className="text-gray-500 text-sm">
          Thanks for reaching out — our support team will get back to you soon.
        </p>
      </div>
    );
  }

  const canSubmit = name.trim() !== "" && message.trim() !== "" && !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError("");
    try {
      await submitSupportEnquiry({
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        subject: subject.trim() || undefined,
        message: message.trim(),
        orderId: orderId.trim() || undefined,
        website: website || undefined,
      });
      setSent(true);
    } catch {
      setError("Something went wrong while sending your message. Please try again or contact us directly.");
    } finally {
      setSubmitting(false);
    }
  }

  const inputClass =
    "w-full h-11 px-3 rounded-xl border border-gray-200 text-[14px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-brand-blue";

  return (
    <div className="bg-white rounded-2xl p-6 md:p-8 border border-gray-100">
      <h3 className="font-bold text-gray-800 text-xl mb-1">Send us a message</h3>
      <p className="text-gray-500 text-sm mb-6">
        Tell us what you need help with — we usually reply within one working day.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="enquiry-name" className="block text-[13px] font-semibold text-gray-700 mb-1">
              Name *
            </label>
            <input
              id="enquiry-name"
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="enquiry-phone" className="block text-[13px] font-semibold text-gray-700 mb-1">
              Phone
            </label>
            <input
              id="enquiry-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="01XXXXXXXXX"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor="enquiry-email" className="block text-[13px] font-semibold text-gray-700 mb-1">
            Email
          </label>
          <input
            id="enquiry-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={inputClass}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="enquiry-subject" className="block text-[13px] font-semibold text-gray-700 mb-1">
              Subject
            </label>
            <input
              id="enquiry-subject"
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What is this about?"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="enquiry-order" className="block text-[13px] font-semibold text-gray-700 mb-1">
              Order ID (optional)
            </label>
            <input
              id="enquiry-order"
              type="text"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="e.g. ORD-260101-0001"
              className={inputClass}
            />
          </div>
        </div>
        <div>
          <label htmlFor="enquiry-message" className="block text-[13px] font-semibold text-gray-700 mb-1">
            Message *
          </label>
          <textarea
            id="enquiry-message"
            required
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Write your question or issue here…"
            rows={5}
            className="w-full px-3 py-2.5 rounded-xl border border-gray-200 text-[14px] text-gray-800 placeholder:text-gray-400 focus:outline-none focus:border-brand-blue"
          />
        </div>
        {/* Honeypot — hidden from humans, not from bots. */}
        <div aria-hidden="true" className="hidden">
          <label htmlFor="enquiry-website">Website</label>
          <input
            id="enquiry-website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={!canSubmit}
          className="inline-flex items-center gap-2 bg-brand-blue hover:bg-brand-blue/90 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 h-11 rounded-full font-bold text-sm transition-all"
        >
          <Send size={16} />
          {submitting ? "Sending…" : "Send message"}
        </button>
      </form>
    </div>
  );
}
