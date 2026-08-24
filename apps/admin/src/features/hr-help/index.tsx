import { useState } from 'react'
import { ChevronDown, LifeBuoy } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface HelpSection {
  id: string
  title: string
  steps: string[]
}

const SECTIONS: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'শুরুর আগে (Getting Started)',
    steps: [
      '১. Admin panel-এ লগ ইন করুন admin@ecomate.com ও আপনার পাসওয়ার্ড দিয়ে।',
      '২. বাম পাশের Sidebar থেকে HR প্যানেল নির্বাচন করুন।',
      '৩. Dashboard থেকে আজকের উপস্থিতি, কর্মচারী সংখ্যা ও পে-রোল অবস্থা দেখুন।',
      '৪. কোনো মেনু না পেলে আপনার Permission-এ তা নেই — HR অ্যাডমিনের কাছে অনুরোধ করুন।',
    ],
  },
  {
    id: 'employee-management',
    title: 'কর্মচারী ব্যবস্থাপনা (Employee Management)',
    steps: [
      '১. Employees → All Employees পেজে যান।',
      '২. Create Employee বাটনে ক্লিক করে নাম, Employee ID, Department, Designation ও Attendance Method দিন।',
      '৩. Departments ও Designations মেনু থেকে আগে থেকেই লিস্ট তৈরি রাখুন।',
      '৪. কারো চাকরি শেষ হলে status পরিবর্তন করুন — ডে-লিস্ট থেকে সরানো লাগবে না।',
    ],
  },
  {
    id: 'salary-payroll',
    title: 'বেতন ও পে-রোল (Salary & Payroll)',
    steps: [
      '১. Employees → কোনো কর্মচারীর Compensation ট্যাবে Salary Structure সেট করুন।',
      '২. Payroll পেজ থেকে মাস নির্বাচন করে Run Payroll চাপুন।',
      '৩. Payslips অটো তৈরি হয় — employee নিজে storefront-এর My HR থেকে দেখতে পায়।',
      '৪. ভুল বেতন দেখালে সংশোধন করে আবার run করুন; history সংরক্ষিত থাকে।',
    ],
  },
  {
    id: 'commission',
    title: 'কমিশন (Commission)',
    steps: [
      '১. Commissions পেজে প্রতিটি employee-র কমিশন নিয়ম দেখুন।',
      '২. নতুন নিয়ম তৈরি করতে Add-এ ক্লিক করে rate ও applicable order type দিন।',
      '৩. প্রতিটি সফল অর্ডরে কমিশন অটো হিসাব হয়ে employee-র My HR-এ দেখা যায়।',
      '৪. কাস্টম কমিশন দিতে চাইলে Earnings/ Deductions দিয়ে দিন।',
    ],
  },
  {
    id: 'leave',
    title: 'ছুটি (Leave)',
    steps: [
      '১. Leave পেজ থেকে Leave Types সেট করুন (প্রতি বছরে কত দিন)।',
      '২. Employee storefront-এর My HR → Leave থেকে আবেদন করে।',
      '৩. Admin Leave ট্যাবে আবেদন Approve বা Reject করুন।',
      '৪. Balance অটো আপডেট হয় — ছুটি কাটলে পে-রোলে হিসাব হবে।',
    ],
  },
  {
    id: 'attendance-modes',
    title: 'উপস্থিতি — APP / MACHINE / BOTH (Attendance)',
    steps: [
      '১. APP মোড: সবাই অ্যাপ/অ্যাডমিন থেকে check-in করে; machine নিষ্ক্রিয়।',
      '২. MACHINE মোড: শুধু ডিভাইস থেকে উপস্থিতি হয়; অ্যাপ check-in বন্ধ।',
      '৩. BOTH মোড: প্রতিটি employee-র method অনুযায়ী (APP বা MACHINE)।',
      '৪. Attendance → Settings ট্যাব থেকে মোড বদলান (Manage HR Settings permission লাগবে)।',
      '৫. Today ট্যাবে employee বাছাই করে Check In / Break / Check Out করুন।',
      '৬. ভুল হলে Adjustments ট্যাব থেকে Reason-সহ সংশোধন করুন।',
    ],
  },
  {
    id: 'devices',
    title: 'ডিভাইস (Devices)',
    steps: [
      '১. Attendance → Devices ট্যাবে Add Device দিয়ে নাম, IP, port দিন।',
      '২. Test connection দিয়ে নিশ্চিত হোন ডিভাইস reachable।',
      '৩. Mappings-এ employee-র device ID বাঁধুন (device employee ID)।',
      '৪. Sync বাটনে ডিভাইস থেকে ইভেন্ট আনুন; MACHINE বা BOTH মোডে কার্যকর।',
    ],
  },
  {
    id: 'my-hr',
    title: 'My HR (কর্মচারী সেলফ-সার্ভিস)',
    steps: [
      '১. Storefront-এ লগ ইন করে Account → My HR খুলুন।',
      '২. Profile, Salary, Payslips, Leave ও Attendance নিজে দেখুন।',
      '৩. Attendance ট্যাব থেকে নিজের Check In / Break / Check Out করুন (APP মোডে)।',
      '৪. Leave আবেদন, payslip ডাউনলোড — সব এক জায়গায়।',
    ],
  },
  {
    id: 'attendance-add-day',
    title: 'উপস্থিতি — হাতে তৈরি অনুপস্থিতি দিবস (Add Day / Manual Absence)',
    steps: [
      '১. Attendance → Adjustments ট্যাবে "Add Day" বাটনে ক্লিক করুন।',
      '২. ডায়ালগে employee নির্বাচন করুন, তারিখ, স্ট্যাটাস (Present / Absent / Leave) ও কারণ দিন।',
      '৩. "Manage Attendance Adjustments" permission ছাড়া এই বাটন দেখাবে না।',
      '৪. যখন employee ভুলে check-in করেন বা remote work ম্যানুয়ালি রেকর্ড করতে হয়, তখন এটি ব্যবহার করুন।',
    ],
  },
  {
    id: 'attendance-missing-checkout',
    title: 'উপস্থিতি — মিসিং চেকআউট (Missing Checkout Handling)',
    steps: [
      '১. "Missing Checkout" ব্যাজ মানে: কর্মচারী check-in করেছেন কিন্তু checkout করেননি — session এখনো খোলা।',
      '২. Today ট্যাবে "Close Session" বাটনে ক্লিক করে checkout সময় রেকর্ড করুন।',
      '৩. মিসিং checkout রেপোর্ট ও পে-রোলে হিসাবে সময় ভুল হতে পারে — তাই এটি সময়মতো সমাধান করুন।',
    ],
  },
  {
    id: 'devices-unmapped',
    title: 'ডিভাইস — আনম্যাপড ইভেন্ট (Unmapped Events)',
    steps: [
      '১. "Unmapped" ব্যাজ মানে: ডিভাইসের ইভেন্ট কোনো employee-র সাথে ম্যাপ হয়নি।',
      '২. Devices → Mappings-এ নতুন ম্যাপিং তৈরি করুন (device employee ID → employee)।',
      '৩. Sync বাটনে আবার ক্লিক করুন — নতুন ম্যাপিং অনুযায়ী ইভেন্ট সমাধান হবে।',
      '৪. Devices ট্যাবে Unmapped ব্যাজ থাকলে সেটি resolve না হওয়া পর্যন্ত দেখাবে।',
    ],
  },
  {
    id: 'commission-reversals',
    title: 'কমিশন — রিভার্সাল (Commission Reversals)',
    steps: [
      '১. অর্ডার refund বা cancel হলে কমিশন অটো রিভার্স হয় — partial refund হলে আনুপাতিক, full cancel হলে পুরো।',
      '২. Reversals earnings ট্যাবে দেখা যায়; reversals ফিল্টার দিয়ে বাছাই করুন।',
      '৩. পেসলিপ approved হলে পরে কমিশন রিভার্স হয় না — তাই পে-রোল run এর আগে সব অর্ডার settle করুন।',
    ],
  },
  {
    id: 'payroll-totals-void',
    title: 'পে-রোল — মোট ও Void (Payroll Totals & Void)',
    steps: [
      '১. Payslip summary এ Gross, Deductions, Commission, Net ও Paid — প্রতিটি মানে: Gross = মোট বেতন + কমিশন; Deductions = কাটা টাকা; Net = Gross − Deductions; Paid = ইতিমধ্যে পরিশোধিত।',
      '২. "Void" মানে পেমেন্ট বাতিল — "Delete" এর পরিবর্তে ব্যবহৃত হয়; audit trail সংরক্ষিত থাকে।',
      '৩. Void করতে: Void বাটনে ক্লিক করুন → কারণ দিন → পেমেন্ট মোট থেকে বাদ পড়বে।',
    ],
  },
  {
    id: 'employee-rehire',
    title: 'কর্মচারী — পুনর্নিয়োগ (Employee Rehire)',
    steps: [
      '১. চাকরি শেষ বা পদত্যাগ করা employee-কে পুনরায় নিয়োগ দিতে: Employee পেজে যান → Edit → নতুন যোগদান তারিখ দিন।',
      '২. Status স্বয়ংক্রিয়ভাবে Active-তে পরিবর্তন হবে।',
      '৩. পুরানো তথ্য (পে-রোল, উপস্থিতি, কমিশন) সংরক্ষিত থাকে — নতুন যোগদান তারিখ থেকে নতুন হিসাব শুরু হয়।',
    ],
  },
  {
    id: 'bank-account-verification',
    title: 'ব্যাংক অ্যাকাউন্ট — যাচাই (Bank Account Verification)',
    steps: [
      '১. "Set as primary" একটি অ্যাকাউন্টকে ডিফল্ট পেমেন্ট অ্যাকাউন্ট হিসেবে নির্ধারণ করে।',
      '২. "Verify" বাটনে ক্লিক করে অ্যাকাউন্ট যাচাই করুন — একটি নোট সহ যাচাইকৃত হিসেবে চিহ্নিত হয়।',
      '৩. যাচাইকৃত অ্যাকাউন্ট ছাড়া পেমেন্ট প্রক্রিয়ায় সমস্যা হতে পারে — তাই নতুন employee যোগ করলে ব্যাংক তথ্য যাচাই করুন।',
    ],
  },
  {
    id: 'session-expiry',
    title: 'সেশন মেয়াদোত্তীর্ণ (Session Expiry)',
    steps: [
      '১. সেশনের মেয়াদ শেষ হলে sign-in পেজে রিডাইরেক্ট হবে একটি ব্যানার সহ।',
      '২. শুধু আবার sign in করুন — কোনো তথ্য হারায় না।',
      '৩. বারবার সেশন মেয়াদ শেষ হলে browser cache পরিষ্কার করুন বা IT টিমের সাথে যোগাযোগ করুন।',
    ],
  },
  {
    id: 'glossary',
    title: 'পরিভাষা তালিকা (Glossary)',
    steps: [
      'Attendance = উপস্থিতি — কর্মচারীর কাজের হাজিরা',
      'Session = সেশন — check-in থেকে checkout পর্যন্ত সময়কাল',
      'Punch = পাঞ্চ — ডিভাইসে হাজিরা নির্দেশক ইভেন্ট',
      'Employee = কর্মচারী — প্রতিষ্ঠানের নিয়মিত বা চুক্তিভিত্তিক কর্মী',
      'Salary Structure = বেতন কাঠামো — মূল বেতন, ভাতা ও কাটা সমূহের সমষ্টি',
      'Payslip = বেতন স্লিপ — মাসিক বেতন প্রতিবেদন',
      'Commission = কমিশন — অর্ডার নির্ভর বোনাস',
      'Leave = ছুটি — অনুমোদিত অনুপস্থিতি',
      'Device Mapping = ডিভাইস ম্যাপিং — ডিভাইস ID-কে employee-র সাথে সংযুক্তকরণ',
      'Void = বাতিল — পেমেন্ট বা লেনদেন অচল করা (audit trail সংরক্ষিত)',
      'Rehire = পুনর্নিয়োগ — পদত্যাগকারী employee-কে আবার নিয়োগ দেওয়া',
    ],
  },
  {
    id: 'troubleshooting',
    title: 'সমস্যা সমাধান (Troubleshooting)',
    steps: [
      '❌ "Session expired" → আবার sign in করুন।',
      '❌ "409 Overlapping leave" → আগের leave request cancel করুন, তারপর নতুন করুন।',
      '❌ "409 Duplicate SKU/slug" → SKU বা slug পরিবর্তন করুন।',
      '❌ "Missing checkout badge" → Today ট্যাবে Close Session ব্যবহার করুন।',
      '❌ "Unmapped events" → Devices → Mappings-এ নতুন ম্যাপিং তৈরি করুন।',
      '❌ "403 Forbidden" → আপনার role permission পরীক্ষা করুন।',
      '❌ "No employee record" → আগে Employee তৈরি করুন।',
      '❌ "Commission after payslip approved" → Manual adjustment তৈরি করুন।',
      '❌ "Salary structure future" → Compensation ট্যাবে দেখুন (amber chip দেখাবে)।',
    ],
  },
]

export function HelpSection({ section, defaultOpen = false }: { section: HelpSection; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className='rounded-lg border bg-card text-card-foreground shadow-sm'>
      <button
        type='button'
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className='flex w-full items-center justify-between gap-3 px-4 py-3 text-left font-semibold text-sm'
      >
        <span>{section.title}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ol className='grid gap-2 border-t px-4 py-3 text-sm text-muted-foreground'>
          {section.steps.map((step) => (
            <li key={step} className='leading-relaxed'>
              {step}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function HelpPage() {
  return (
    <>
      <Header fixed>
        <GlobalSearchBar className='me-auto' />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>

      <Main className='flex flex-1 flex-col gap-4 sm:gap-6'>
        <div>
          <h2 className='flex items-center gap-2 text-2xl font-bold tracking-tight'>
            <LifeBuoy className='h-6 w-6 text-muted-foreground' /> HR Help
          </h2>
          <p className='mt-1 text-sm text-muted-foreground'>
            HR প্যানেল ব্যবহারের ধাপে ধাপে বাংলা গাইড — English terms স্বাভাবিকভাবেই ব্যবহৃত।
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>বিষয়সূচি (Index)</CardTitle>
            <CardDescription>যেকোনো বিভাগে ক্লিক করে বিস্তারিত দেখুন।</CardDescription>
          </CardHeader>
          <CardContent className='grid gap-3'>
            {SECTIONS.map((section, i) => (
              <HelpSection key={section.id} section={section} defaultOpen={i === 0} />
            ))}
          </CardContent>
        </Card>
      </Main>
    </>
  )
}