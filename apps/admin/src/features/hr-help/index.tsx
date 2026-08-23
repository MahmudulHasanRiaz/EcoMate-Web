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