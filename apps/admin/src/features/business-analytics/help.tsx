'use client'

import { HelpCircle } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { AnalyticsPageHeader, AnalyticsSection } from './components/analytics-ui'

/** Question → page rows for the "which page" table. Destinations are canonical sidebar routes. */
const QUESTION_ROWS: { q: string; page: string; to: string; note?: string }[] = [
  { q: 'Business কেমন করেছে?', page: 'Business Overview', to: '/mon/analytics' },
  { q: 'Sales/Return/Refund?', page: 'Sales & Orders', to: '/mon/analytics/sales' },
  { q: 'কোন Product লাভ?', page: 'Products', to: '/mon/analytics/products' },
  { q: 'Customer performance?', page: 'Customers', to: '/mon/analytics/customers' },
  { q: 'Marketing spend কাজ?', page: 'Marketing', to: '/mon/analytics/marketing', note: 'ROAS, CAC, CPA' },
  { q: 'Stock situation?', page: 'Inventory', to: '/mon/analytics/inventory' },
  { q: 'কোথায় খরচ?', page: 'Expenses', to: '/mon/analytics/expenses' },
]

const bodyClass = 'text-sm text-muted-foreground space-y-1.5 leading-relaxed'
const listClass = 'space-y-1.5'

/**
 * Analytics Help (Bengali onboarding guide): what Analytics is, where to
 * start, which page answers which question, how to trace a problem, what the
 * data states mean, and the Dashboard-vs-Analytics rule. Names only real
 * badges and links — never promises every number is clickable.
 */
export default function AnalyticsHelp() {
  return (
    <div className="p-4 sm:p-6">
      <div className="mx-auto max-w-3xl space-y-6" data-testid="analytics-help">
        <AnalyticsPageHeader
          icon={HelpCircle}
          title="Analytics — সাহায্য"
          subtitle="কোন সংখ্যা কোথায় পাবেন, আর কোনটা কতটা বিশ্বাস করবেন।"
        />

        <AnalyticsSection title="Analytics কী?">
          <div className={bodyClass}>
            <p>Analytics মানে এ পর্যন্ত কী হলো তার হিসাব — কত বিক্রি, কত লাভ, কোথায় খরচ।</p>
            <p>শুধু Delivered অর্ডারই Revenue; ডেলিভারির আগের অর্ডার এখনো বিক্রি নয়।</p>
            <p>Net Sales থেকে Net Profit পর্যন্ত পুরো পথ Business Overview-এ দেখুন।</p>
          </div>
        </AnalyticsSection>

        <AnalyticsSection title="কোথা থেকে শুরু করবেন">
          <ol className={`${bodyClass} ${listClass} list-decimal pl-5`}>
            <li>Date Range ঠিক করুন — আজ, গত ৭ দিন, এই মাস, বা custom তারিখ।</li>
            <li>Business Overview খুলুন — Net Sales, লাভ আর আদায়ের সারসংক্ষেপ দেখুন।</li>
            <li>পরিবর্তন চিহ্নিত করুন — আগের period-এর সাথে তুলনা করে বদলের জায়গাটা ধরুন।</li>
            <li>নিচের টেবিল থেকে প্রশ্ন অনুযায়ী page বেছে নিন (Inventory-তে warehouse scope দিতে পারেন)।</li>
            <li>Drill Down ধরে সংখ্যা থেকে আসল অর্ডার পর্যন্ত যান।</li>
          </ol>
        </AnalyticsSection>

        <AnalyticsSection title="কোন প্রশ্নের জন্য কোন page?">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-3 font-medium">প্রশ্ন</th>
                <th className="pb-2 font-medium">Page</th>
              </tr>
            </thead>
            <tbody>
              {QUESTION_ROWS.map((r) => (
                <tr key={r.to} className="border-t border-border">
                  <td className="py-2 pr-3 text-muted-foreground">{r.q}</td>
                  <td className="py-2">
                    <Link to={r.to}>
                      <Badge variant="outline" className="cursor-pointer hover:bg-muted">
                        {r.page}
                      </Badge>
                    </Link>
                    {r.note ? <span className="ml-2 text-xs text-muted-foreground">{r.note}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </AnalyticsSection>

        <AnalyticsSection title="সমস্যা খোঁজার workflow">
          <ol className={`${bodyClass} ${listClass} list-decimal pl-5`}>
            <li>Business Overview-এ অস্বাভাবিক সংখ্যাটা ধরুন।</li>
            <li>Breakdown-এ ভাগ করে দেখুন সমস্যা কোন অংশে।</li>
            <li>সংশ্লিষ্ট section-এ গিয়ে Entity — Product, Customer বা campaign — নির্দিষ্ট করুন।</li>
            <li>Drill Down link ধরে অর্ডার পর্যন্ত যান।</li>
            <li>fix-list পেলে আগে সেটা ঠিক করুন — fix-list মানে পূরণ করার মতো তথ্য-ঘাটতির তালিকা।</li>
          </ol>
        </AnalyticsSection>

        <AnalyticsSection title="Data status কী বোঝায়?">
          <div className={bodyClass}>
            <ul className={`${listClass} list-disc pl-5`}>
              <li>Actual — যাচাই করা তথ্যের হিসাব।</li>
              <li>Estimated — আংশিক তথ্যে আনুমানিক হিসাব; badge-এ চিহ্নিত থাকে।</li>
              <li>Unavailable — এই scope-এ তথ্য নেই; শূন্য নয়।</li>
              <li>No Data — এই period-এ রেকর্ড নেই; ফাঁকাও শূন্য নয়।</li>
            </ul>
            <p>তারিখহীন খরচ মোটে ধরা হয় না — fix-list থেকে তারিখ ঠিক করুন। Inventory-তে closing-only basis মানে শুধু সমাপনী স্থিতি।</p>
          </div>
        </AnalyticsSection>

        <AnalyticsSection title="Dashboard বনাম Analytics">
          <div className={bodyClass}>
            <p>Dashboard মানে এখন কী করা দরকার — বাকি অর্ডার, কম Stock, সতর্কতা।</p>
            <p>লাভ-ক্ষতির সব প্রশ্ন Analytics-এ দেখুন; আজকের কাজের জন্য Dashboard দেখুন।</p>
          </div>
        </AnalyticsSection>

        <AnalyticsSection title="শেষ কথা">
          <div className={bodyClass}>
            <p>ⓘ কোনো সংখ্যা নিয়ে সন্দেহ হলে Drill Down link, Low margin badge, uncosted badge বা coverage badge ধরে উৎস পর্যন্ত যান।</p>
          </div>
        </AnalyticsSection>
      </div>
    </div>
  )
}
