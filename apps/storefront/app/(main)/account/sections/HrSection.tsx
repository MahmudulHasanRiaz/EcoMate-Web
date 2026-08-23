"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2,
  User,
  Wallet,
  Receipt,
  TrendingUp,
  ArrowDownCircle,
  CalendarOff,
  CalendarDays,
  CalendarCheck,
  ChevronDown,
  Send,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useStorefrontConfig } from "@/context/StorefrontConfigContext";
import {
  getHrProfile,
  getHrSalary,
  getHrPayslips,
  getHrPayslipPayments,
  getHrCommissions,
  getHrEarnings,
  getHrDeductions,
  getHrSchedule,
  getHrLeaveTypes,
  getHrLeaveRequests,
  createHrLeaveRequest,
  cancelHrLeaveRequest,
  getHrMyAttendance,
  type HrProfile,
  type SalaryStructure,
  type Payslip,
  type PayrollPayment,
  type CommissionEarning,
  type EmployeeEarning,
  type EmployeeDeduction,
  type LeaveType,
  type LeaveRequest,
  type AttendanceRecord,
} from "@/lib/api/hr";

type TabKey =
  | "profile"
  | "salary"
  | "payslips"
  | "commission"
  | "earnings"
  | "deductions"
  | "leave"
  | "schedule"
  | "attendance";

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "profile", label: "Profile", icon: <User size={16} /> },
  { key: "salary", label: "Salary", icon: <Wallet size={16} /> },
  { key: "payslips", label: "Payslips", icon: <Receipt size={16} /> },
  { key: "commission", label: "Commission", icon: <TrendingUp size={16} /> },
  { key: "earnings", label: "Earnings", icon: <TrendingUp size={16} /> },
  { key: "deductions", label: "Deductions", icon: <ArrowDownCircle size={16} /> },
  { key: "leave", label: "Leave", icon: <CalendarOff size={16} /> },
  { key: "schedule", label: "Schedule", icon: <CalendarDays size={16} /> },
  { key: "attendance", label: "Attendance", icon: <CalendarCheck size={16} /> },
];

function statusTone(s?: string) {
  const v = (s || "").toLowerCase();
  if (["paid", "approved", "active", "completed", "confirmed"].includes(v))
    return "bg-green-100 text-green-700";
  if (
    ["rejected", "cancelled", "canceled", "unpaid", "failed", "inactive"].includes(
      v,
    )
  )
    return "bg-red-100 text-red-700";
  return "bg-amber-100 text-amber-700";
}

function StatusBadge({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <span
      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${statusTone(
        value,
      )}`}
    >
      {value}
    </span>
  );
}

function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <Loader2 className="animate-spin text-brand-blue" size={28} />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="text-center py-12 text-gray-400">
      <p>{message}</p>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 md:p-8">
      {children}
    </div>
  );
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/* ---------------- Profile ---------------- */
function ProfileTab() {
  const { config } = useStorefrontConfig();
  const [data, setData] = useState<HrProfile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHrProfile()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (!data) return <EmptyState message="Profile not available" />;

  const rows: { label: string; value: string }[] = [
    { label: "Name", value: data.betterAuthUser?.name || "—" },
    { label: "Employee ID", value: data.employeeId || "—" },
    { label: "Email", value: data.betterAuthUser?.email || "—" },
    { label: "Department", value: data.department?.name || "—" },
    { label: "Designation", value: data.designation?.name || "—" },
    {
      label: "Manager",
      value: data.reportingTo?.betterAuthUser?.name
        ? `${data.reportingTo.betterAuthUser.name} (${
            data.reportingTo.employeeId || "—"
          })`
        : "—",
    },
    {
      label: "Salary",
      value:
        typeof data.salary === "number"
          ? `${config.currency.symbol}${data.salary.toLocaleString()}`
          : "—",
    },
  ];

  return (
    <Card>
      <h3 className="text-xl font-bold text-gray-800 mb-6">My Profile</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {rows.map((r) => (
          <div
            key={r.label}
            className="flex justify-between items-center p-4 rounded-xl bg-gray-50"
          >
            <span className="text-xs font-semibold text-gray-500">
              {r.label}
            </span>
            <span className="text-sm font-medium text-gray-800 text-right">
              {r.value}
            </span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- Salary ---------------- */
function SalaryTab() {
  const { config } = useStorefrontConfig();
  const [data, setData] = useState<SalaryStructure | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    getHrSalary()
      .then(setData)
      .catch((err) => {
        if (err?.response?.status === 404) setNotFound(true);
        setData(null);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;
  if (notFound || !data)
    return (
      <Card>
        <h3 className="text-xl font-bold text-gray-800 mb-6">Salary</h3>
        <EmptyState message="No active salary structure" />
      </Card>
    );

  const sym = config.currency.symbol;
  const earnings = [
    { label: "Basic Salary", value: data.basicSalary },
    { label: "House Allowance", value: data.houseAllowance },
    { label: "Medical Allowance", value: data.medicalAllowance },
    { label: "Transport Allowance", value: data.transportAllowance },
    { label: "Other Allowance", value: data.otherAllowance },
  ];
  const deductions = [
    { label: "Tax Deduction", value: data.taxDeduction },
    { label: "Insurance Deduction", value: data.insuranceDeduction },
    { label: "Other Deduction", value: data.otherDeduction },
  ];

  return (
    <Card>
      <h3 className="text-xl font-bold text-gray-800 mb-6">Salary Structure</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <h4 className="text-sm font-bold text-gray-600 mb-3">Earnings</h4>
          <div className="space-y-2">
            {earnings.map((e) => (
              <div
                key={e.label}
                className="flex justify-between items-center p-3 rounded-xl bg-green-50"
              >
                <span className="text-sm text-gray-600">{e.label}</span>
                <span className="text-sm font-semibold text-gray-800 tabular-nums">
                  {sym}
                  {Number(e.value || 0).toLocaleString()}
                </span>
              </div>
            ))}
            <div className="flex justify-between items-center p-3 rounded-xl bg-green-100 font-bold">
              <span className="text-sm">Total Earnings</span>
              <span className="tabular-nums">
                {sym}
                {Number(data.totalEarnings || 0).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
        <div>
          <h4 className="text-sm font-bold text-gray-600 mb-3">Deductions</h4>
          <div className="space-y-2">
            {deductions.map((d) => (
              <div
                key={d.label}
                className="flex justify-between items-center p-3 rounded-xl bg-red-50"
              >
                <span className="text-sm text-gray-600">{d.label}</span>
                <span className="text-sm font-semibold text-gray-800 tabular-nums">
                  {sym}
                  {Number(d.value || 0).toLocaleString()}
                </span>
              </div>
            ))}
            <div className="flex justify-between items-center p-3 rounded-xl bg-red-100 font-bold">
              <span className="text-sm">Total Deductions</span>
              <span className="tabular-nums">
                {sym}
                {Number(data.totalDeductions || 0).toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
      <div className="mt-6 flex justify-between items-center p-4 rounded-xl bg-brand-blue/10 border border-brand-blue/20">
        <span className="text-sm font-bold text-gray-700">Net Salary</span>
        <span className="text-lg font-bold text-brand-blue tabular-nums">
          {sym}
          {Number(data.netSalary || 0).toLocaleString()}
        </span>
      </div>
    </Card>
  );
}

/* ---------------- Payslips ---------------- */
function PayslipsTab() {
  const { config } = useStorefrontConfig();
  const [items, setItems] = useState<Payslip[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [payments, setPayments] = useState<Record<string, PayrollPayment[]>>({});
  const [loadingPayments, setLoadingPayments] = useState<string | null>(null);

  useEffect(() => {
    getHrPayslips(1, 50)
      .then((res) => setItems(res.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = async (id: string) => {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    setExpanded(id);
    if (!payments[id]) {
      setLoadingPayments(id);
      try {
        const res = await getHrPayslipPayments(id);
        setPayments((p) => ({ ...p, [id]: res || [] }));
      } catch {
        setPayments((p) => ({ ...p, [id]: [] }));
      } finally {
        setLoadingPayments(null);
      }
    }
  };

  if (loading) return <Spinner />;
  if (items.length === 0)
    return (
      <Card>
        <h3 className="text-xl font-bold text-gray-800 mb-6">Payslips</h3>
        <EmptyState message="No payslips found" />
      </Card>
    );

  const sym = config.currency.symbol;

  return (
    <Card>
      <h3 className="text-xl font-bold text-gray-800 mb-6">Payslips</h3>
      <div className="space-y-3">
        {items.map((p) => (
          <div key={p.id} className="rounded-xl border border-gray-100">
            <button
              onClick={() => toggle(p.id)}
              className="w-full flex items-center justify-between p-4 text-left"
            >
              <div>
                <p className="font-semibold text-gray-800 text-sm">
                  {p.periodKey}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">
                  {fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}
                </p>
                <p className="text-xs text-gray-500 mt-1 tabular-nums">
                  Net: {sym}
                  {Number(p.netPay || 0).toLocaleString()}
                  {p.paidAt ? ` · Paid ${fmtDate(p.paidAt)}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusBadge value={p.status} />
                <ChevronDown
                  size={16}
                  className={`text-gray-400 transition-transform ${
                    expanded === p.id ? "rotate-180" : ""
                  }`}
                />
              </div>
            </button>
            {expanded === p.id && (
              <div className="px-4 pb-4">
                {loadingPayments === p.id ? (
                  <Spinner />
                ) : (payments[p.id] || []).length === 0 ? (
                  <p className="text-xs text-gray-400 py-2">
                    No payments recorded
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-xs text-gray-500">
                          <th className="py-2 pr-4 font-semibold">Date</th>
                          <th className="py-2 pr-4 font-semibold">Method</th>
                          <th className="py-2 pr-4 font-semibold">Reference</th>
                          <th className="py-2 pr-4 font-semibold text-right">
                            Amount
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {(payments[p.id] || []).map((pay) => (
                          <tr key={pay.id} className="border-t border-gray-50">
                            <td className="py-2 pr-4 text-gray-600">
                              {fmtDate(pay.paidAt)}
                            </td>
                            <td className="py-2 pr-4 text-gray-600">
                              {pay.method || "—"}
                            </td>
                            <td className="py-2 pr-4 text-gray-600">
                              {pay.referenceNo || "—"}
                            </td>
                            <td className="py-2 pr-4 text-right font-semibold tabular-nums">
                              {sym}
                              {Number(pay.amount || 0).toLocaleString()}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ---------------- Commission ---------------- */
function CommissionTab() {
  const { config } = useStorefrontConfig();
  const [items, setItems] = useState<CommissionEarning[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHrCommissions(1, 50)
      .then((res) => setItems(res.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <Card>
      <h3 className="text-xl font-bold text-gray-800 mb-6">My Commissions</h3>
      {items.length === 0 ? (
        <EmptyState message="No commission earnings found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-semibold">Order</th>
                <th className="py-2 pr-4 font-semibold">Date</th>
                <th className="py-2 pr-4 font-semibold text-right">Amount</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t border-gray-50">
                  <td className="py-3 pr-4 text-gray-700">
                    {c.order?.displayId || c.orderId}
                  </td>
                  <td className="py-3 pr-4 text-gray-500">
                    {fmtDate(c.createdAt)}
                  </td>
                  <td className="py-3 pr-4 text-right font-semibold tabular-nums">
                    {config.currency.symbol}
                    {Number(c.amount || 0).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge value={c.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Earnings ---------------- */
function EarningsTab() {
  const { config } = useStorefrontConfig();
  const [items, setItems] = useState<EmployeeEarning[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHrEarnings(1, 50)
      .then((res) => setItems(res.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <Card>
      <h3 className="text-xl font-bold text-gray-800 mb-6">My Earnings</h3>
      {items.length === 0 ? (
        <EmptyState message="No earnings found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-semibold">Type</th>
                <th className="py-2 pr-4 font-semibold text-right">Amount</th>
                <th className="py-2 pr-4 font-semibold">Reason</th>
                <th className="py-2 pr-4 font-semibold">Period</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((e) => (
                <tr key={e.id} className="border-t border-gray-50">
                  <td className="py-3 pr-4 text-gray-700">{e.type}</td>
                  <td className="py-3 pr-4 text-right font-semibold tabular-nums">
                    {config.currency.symbol}
                    {Number(e.amount || 0).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-gray-500">{e.reason || "—"}</td>
                  <td className="py-3 pr-4 text-gray-500">
                    {fmtDate(e.applicableFrom)} – {fmtDate(e.applicableTo)}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge value={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Deductions ---------------- */
function DeductionsTab() {
  const { config } = useStorefrontConfig();
  const [items, setItems] = useState<EmployeeDeduction[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHrDeductions(1, 50)
      .then((res) => setItems(res.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <Card>
      <h3 className="text-xl font-bold text-gray-800 mb-6">My Deductions</h3>
      {items.length === 0 ? (
        <EmptyState message="No deductions found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-semibold">Type</th>
                <th className="py-2 pr-4 font-semibold text-right">Amount</th>
                <th className="py-2 pr-4 font-semibold">Reason</th>
                <th className="py-2 pr-4 font-semibold">Period</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-t border-gray-50">
                  <td className="py-3 pr-4 text-gray-700">{d.type}</td>
                  <td className="py-3 pr-4 text-right font-semibold tabular-nums">
                    {config.currency.symbol}
                    {Number(d.amount || 0).toLocaleString()}
                  </td>
                  <td className="py-3 pr-4 text-gray-500">{d.reason || "—"}</td>
                  <td className="py-3 pr-4 text-gray-500">
                    {fmtDate(d.applicableFrom)} – {fmtDate(d.applicableTo)}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge value={d.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Leave ---------------- */
const FALLBACK_LEAVE_TYPES: LeaveType[] = [
  { id: "", name: "Casual Leave", code: "casual", daysPerYear: 0, isPaid: true, isActive: true },
  { id: "", name: "Sick Leave", code: "sick", daysPerYear: 0, isPaid: true, isActive: true },
  { id: "", name: "Annual Leave", code: "annual", daysPerYear: 0, isPaid: true, isActive: true },
];

function LeaveTab() {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [typeId, setTypeId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [formError, setFormError] = useState("");

  const loadRequests = useCallback(() => {
    getHrLeaveRequests(1, 50)
      .then((res) => setRequests(res.data || []))
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadRequests();
    getHrLeaveTypes()
      .then((t) => {
        if (t && t.length) {
          setTypes(t);
          setTypeId(t[0].id);
        } else {
          setTypes(FALLBACK_LEAVE_TYPES);
        }
      })
      .catch(() => {
        setTypes(FALLBACK_LEAVE_TYPES);
      });
  }, [loadRequests]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!typeId) return setFormError("Please select a leave type");
    if (!startDate || !endDate) return setFormError("Please select dates");
    if (new Date(endDate) < new Date(startDate))
      return setFormError("End date must be on or after start date");
    setSubmitting(true);
    try {
      await createHrLeaveRequest({ typeId, startDate, endDate, reason });
      toast.success("Leave request submitted");
      setReason("");
      setStartDate("");
      setEndDate("");
      if (types[0]?.id) setTypeId(types[0].id);
      loadRequests();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await cancelHrLeaveRequest(id);
      toast.success("Leave request cancelled");
      loadRequests();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || "Failed to cancel request");
    }
  };

  return (
    <Card>
      <h3 className="text-xl font-bold text-gray-800 mb-6">My Leave Requests</h3>

      <form
        onSubmit={handleSubmit}
        className="mb-8 p-4 rounded-xl bg-gray-50 space-y-4"
      >
        <h4 className="text-sm font-bold text-gray-700">Apply for Leave</h4>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600 ml-1">
              Leave Type
            </label>
            <select
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl outline-none focus:border-brand-blue text-sm"
            >
              {types.map((t) => (
                <option key={t.id || t.code} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600 ml-1">
              Reason
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl outline-none focus:border-brand-blue text-sm"
              placeholder="Reason for leave"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600 ml-1">
              Start Date
            </label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl outline-none focus:border-brand-blue text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-gray-600 ml-1">
              End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full h-11 px-4 bg-white border border-gray-200 rounded-xl outline-none focus:border-brand-blue text-sm"
            />
          </div>
        </div>
        {formError && (
          <div className="text-red-500 text-xs font-medium bg-red-50 p-3 rounded-xl">
            {formError}
          </div>
        )}
        <button
          type="submit"
          disabled={submitting}
          className="bg-brand-blue hover:bg-brand-blue/90 text-white px-6 h-10 rounded-xl text-sm font-bold transition-all shadow-sm active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {submitting ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <Send size={16} />
          )}
          Submit Request
        </button>
      </form>

      {loading ? (
        <Spinner />
      ) : requests.length === 0 ? (
        <EmptyState message="No leave requests found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-semibold">Type</th>
                <th className="py-2 pr-4 font-semibold">Range</th>
                <th className="py-2 pr-4 font-semibold">Days</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-t border-gray-50">
                  <td className="py-3 pr-4 text-gray-700">{r.type?.name}</td>
                  <td className="py-3 pr-4 text-gray-500">
                    {fmtDate(r.startDate)} – {fmtDate(r.endDate)}
                  </td>
                  <td className="py-3 pr-4 text-gray-500 tabular-nums">
                    {r.days}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge value={r.status} />
                  </td>
                  <td className="py-3 pr-4 text-right">
                    {(r.status === "pending" || r.status === "approved") && (
                      <button
                        onClick={() => handleCancel(r.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700"
                      >
                        <X size={14} /> Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

/* ---------------- Schedule ---------------- */
function ScheduleTab() {
  const [days, setDays] = useState<number[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHrSchedule()
      .then((res) => setDays(res.days || []))
      .catch(() => setDays([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  const NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  return (
    <Card>
      <h3 className="text-xl font-bold text-gray-800 mb-6">My Weekly Schedule</h3>
      {!days || days.length === 0 ? (
        <EmptyState message="No weekly off days configured" />
      ) : (
        <div className="flex flex-wrap gap-2">
          {days.map((d) => (
            <span
              key={d}
              className="px-4 py-2 rounded-xl bg-brand-blue/10 text-brand-blue font-semibold text-sm"
            >
              {NAMES[d] ?? `Day ${d}`}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ---------------- Attendance ---------------- */
const ATTENDANCE_LABELS: Record<string, string> = {
  PRESENT: "Present",
  ABSENT: "Absent",
  LATE: "Late",
  HALF_DAY: "Half Day",
  ON_LEAVE: "On Leave",
  WEEKLY_OFF: "Weekly Off",
};

const ATTENDANCE_TONE: Record<string, string> = {
  PRESENT: "bg-green-100 text-green-700",
  ABSENT: "bg-red-100 text-red-700",
  LATE: "bg-amber-100 text-amber-700",
  HALF_DAY: "bg-blue-100 text-blue-700",
  ON_LEAVE: "bg-violet-100 text-violet-700",
  WEEKLY_OFF: "bg-gray-100 text-gray-600",
};

function AttendanceStatusBadge({ value }: { value?: string }) {
  if (!value) return null;
  const key = value.toUpperCase();
  return (
    <span
      className={`inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full ${
        ATTENDANCE_TONE[key] || statusTone(value)
      }`}
    >
      {ATTENDANCE_LABELS[key] || value}
    </span>
  );
}

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function AttendanceTab() {
  const [items, setItems] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getHrMyAttendance()
      .then((res) => setItems(Array.isArray(res) ? res : []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner />;

  return (
    <Card>
      <h3 className="text-xl font-bold text-gray-800 mb-6">My Attendance</h3>
      {items.length === 0 ? (
        <EmptyState message="No attendance records found" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500">
                <th className="py-2 pr-4 font-semibold">Date</th>
                <th className="py-2 pr-4 font-semibold">Status</th>
                <th className="py-2 pr-4 font-semibold">Check In</th>
                <th className="py-2 pr-4 font-semibold">Check Out</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-gray-50">
                  <td className="py-3 pr-4 text-gray-700">{fmtDate(r.date)}</td>
                  <td className="py-3 pr-4">
                    <AttendanceStatusBadge value={r.status} />
                  </td>
                  <td className="py-3 pr-4 text-gray-500">{fmtTime(r.checkInTime)}</td>
                  <td className="py-3 pr-4 text-gray-500">{fmtTime(r.checkOutTime)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export function HrSection() {
  const [active, setActive] = useState<TabKey>("profile");

  const render = () => {
    switch (active) {
      case "profile":
        return <ProfileTab />;
      case "salary":
        return <SalaryTab />;
      case "payslips":
        return <PayslipsTab />;
      case "commission":
        return <CommissionTab />;
      case "earnings":
        return <EarningsTab />;
      case "deductions":
        return <DeductionsTab />;
      case "leave":
        return <LeaveTab />;
      case "schedule":
        return <ScheduleTab />;
      case "attendance":
        return <AttendanceTab />;
      default:
        return <ProfileTab />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-1">My HR</h2>
        <p className="text-sm text-gray-500">
          Your profile, compensation, and self-service requests
        </p>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActive(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              active === tab.key
                ? "bg-brand-blue text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {render()}
    </div>
  );
}
