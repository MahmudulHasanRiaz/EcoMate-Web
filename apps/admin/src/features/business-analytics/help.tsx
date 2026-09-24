'use client'

import { HelpCircle } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

function HelpSection({ title, to, linkLabel, children }: { title: string; to?: string; linkLabel?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base">{title}</CardTitle>
          {to && linkLabel ? (
            <Link to={to as any}>
              <Badge variant="outline" className="cursor-pointer hover:bg-muted">{linkLabel}</Badge>
            </Link>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground space-y-1.5">
        <ul className="list-disc pl-5 space-y-1.5 leading-relaxed">{children}</ul>
      </CardContent>
    </Card>
  )
}

/**
 * Analytics Help (Bengali, practical): where to look, in which order, and
 * which numbers to trust. No formulas, no implementation details.
 */
export default function AnalyticsHelp() {
  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Analytics — সাহায্য</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/mon/analytics">
            <Badge variant="outline" className="cursor-pointer hover:bg-muted">Business Overview-এ ফিরুন</Badge>
          </Link>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="mx-auto max-w-3xl space-y-6" data-testid="analytics-help">
          <Card>
            <CardContent className="pt-6 text-sm text-muted-foreground space-y-2 leading-relaxed">
              <p>এই Analytics পেজগুলোতে আপনার ব্যবসার আসল ছবি দেখবেন — কত বিক্রি হলো, কত লাভ হলো, কোথায় খরচ হলো।</p>
              <p>মনে রাখবেন: শুধু <strong className="text-foreground">ডেলিভারি হওয়া অর্ডারই</strong> বিক্রি হিসেবে ধরা হয়। ডেলিভারির আগের অর্ডার এখনো বিক্রি নয়।</p>
            </CardContent>
          </Card>

          <HelpSection title="১. সবার আগে: Business Overview" to="/mon/analytics" linkLabel="পেজটি খুলুন">
            <li>প্রথমে সবসময় Business Overview দেখুন — এখানে মোট বিক্রি, মোট লাভ আর টাকা আদায়ের সারসংক্ষেপ থাকে।</li>
            <li>উপরের ফিল্টার দিয়ে সময় বাছুন (যেমন: গত ৭ দিন, এই মাস)।</li>
            <li>কোনো সংখ্যায় ক্লিক করলে নিচে বিস্তারিত (Drill Down) পাবেন।</li>
          </HelpSection>

          <HelpSection title="২. বিক্রি: Sales & Orders" to="/mon/analytics/sales" linkLabel="পেজটি খুলুন">
            <li>কত অর্ডার এলো, কত ডেলিভারি হলো, কত টাকা আদায় হলো — তিনটা আলাদা করে দেখুন।</li>
            <li>কোন মাধ্যমে টাকা এলো (বিকাশ/নগদ/ক্যাশ) তা Payment Methods ট্যাবে দেখুন।</li>
            <li>বাতিল, ফেরত আর রিফান্ড আলাদা ট্যাবে থাকে — ক্ষতির কারণ এখানেই খুঁজুন।</li>
          </HelpSection>

          <HelpSection title="৩. পণ্য: Products" to="/mon/analytics/products" linkLabel="পেজটি খুলুন">
            <li>কোন পণ্যে কত বিক্রি আর কত লাভ — পণ্য অনুযায়ী তালিকা দেখুন।</li>
            <li>কম লাভের পণ্যে ক্লিক করলে সেই পণ্যের বিস্তারিত পেজ খুলবে।</li>
            <li>সার্চ দিয়ে নির্দিষ্ট পণ্য খুঁজুন; Net Sales, Units বা Margin অনুযায়ী সাজান।</li>
          </HelpSection>

          <HelpSection title="৪. কাস্টমার: Customers" to="/mon/analytics/customers" linkLabel="পেজটি খুলুন">
            <li>নতুন কাস্টমার কত এলো, পুরনো কাস্টমার কত ফিরে এলো — আলাদা করে দেখুন।</li>
            <li>নিয়মিত বড় অর্ডার করা কাস্টমারদের VIP হিসেবে চিনুন।</li>
            <li>ফোন নম্বর ছাড়া অর্ডার কাস্টমারের সাথে যুক্ত হয় না — ফোন নম্বর নেওয়ার অভ্যাস করুন।</li>
          </HelpSection>

          <HelpSection title="৫. মার্কেটিং: Marketing" to="/mon/analytics/marketing" linkLabel="পেজটি খুলুন">
            <li>বিজ্ঞাপনে কত খরচ হলো আর সেই খরচে কত বিক্রি এলো — পাশাপাশি দেখুন।</li>
            <li>কোনো খরচের তারিখ না থাকলে সেটা মোট হিসাবে ধরা হয় না — নিচের fix-list থেকে ঠিক করুন।</li>
            <li>খরচ আর বিক্রির সময়কাল না মিললে ঘাবড়াবেন না — এটা স্বাভাবিক, ভুল নয়।</li>
          </HelpSection>

          <HelpSection title="৬. ইনভেন্টরি: Inventory" to="/mon/analytics/inventory" linkLabel="পেজটি খুলুন">
            <li>মজুদের মোট মূল্য আর কোন পণ্য দ্রুত/ধীরে বিক্রি হচ্ছে — এখানে দেখুন।</li>
            <li>স্টক শেষ হয়ে বিক্রি হারাচ্ছেন কি না, stock-out তালিকায় দেখুন।</li>
            <li>যেকোনো সংখ্যায় ক্লিক করলে স্টকের লেনদেনের খতিয়ান (ledger) পাবেন।</li>
          </HelpSection>

          <HelpSection title="৭. খরচ: Expenses" to="/mon/analytics/expenses" linkLabel="পেজটি খুলুন">
            <li>খরচের খাত (ভাড়া, বেতন, কুরিয়ার) অনুযায়ী মোট খরচ দেখুন।</li>
            <li>কোনো খাতে ক্লিক করলে সেই খাতের প্রতিটি খরচের তালিকা পাবেন।</li>
            <li>মোট খরচ Business Overview-এর লাভের হিসাবে প্রতিফলিত হয়।</li>
          </HelpSection>

          <HelpSection title="৮. ড্রিল-ডাউন: সংখ্যা থেকে অর্ডার পর্যন্ত">
            <li>প্রতিটি পেজের নিচে Drill Down বক্স থাকে — সংখ্যা থেকে ধাপে ধাপে আসল অর্ডার পর্যন্ত যান।</li>
            <li>লাভ → খরচের খাত → অর্ডার: কোথায় টাকা গেল, এই পথে খুঁজুন।</li>
            <li>সময়ের ফিল্টার প্রতিটি ধাপে একই থাকে — ফলে সংখ্যা মিলে যায়।</li>
          </HelpSection>

          <HelpSection title="৯. খরচ ও কভারেজ: যা নেই তা শূন্য নয়">
            <li>কোনো পণ্যের কেনা-দাম (cost) না থাকলে সেই অংশের লাভ হিসাব হয় না — শূন্য ধরে নেওয়া হয় না।</li>
            <li>এমন পণ্য থাকলে পেজে সতর্কতা (badge) দেখায় — সেখানে ক্লিক করে তালিকা দেখুন ও দাম বসান।</li>
            <li>তথ্য না থাকলে সংখ্যার পাশে কারণ লেখা থাকে — ফাঁকা বা শূন্য দেখে ভুল সিদ্ধান্ত নেবেন না।</li>
          </HelpSection>

          <HelpSection title="১০. নিয়ম: Dashboard বনাম Analytics" to="/mon/overview" linkLabel="Dashboard খুলুন">
            <li>Dashboard মানে <strong className="text-foreground">এখন কী করা দরকার</strong> — বাকি অর্ডার, কম স্টক, সতর্কতা, সাম্প্রতিক কাজ।</li>
            <li>Analytics মানে <strong className="text-foreground">এ পর্যন্ত কী হলো</strong> — বিক্রি, লাভ, তুলনা, কারণ বিশ্লেষণ।</li>
            <li>লাভ-ক্ষতির প্রশ্ন সবসময় Analytics-এ দেখুন; আজকের কাজের জন্য Dashboard দেখুন।</li>
          </HelpSection>
        </div>
      </Main>
    </>
  )
}
