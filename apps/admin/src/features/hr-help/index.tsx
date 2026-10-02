import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import {
  ChevronDown,
  LifeBuoy,
  LayoutDashboard,
  TrendingUp,
  UserCog,
  DollarSign,
  Percent,
  CalendarDays,
  CalendarCheck,
  Clock,
  Settings,
  ShieldCheck,
} from 'lucide-react'
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

/** Every HR sidebar destination, so the guide matches the real navigation. */
const PAGES = [
  { title: 'Dashboard', to: '/hr/overview', icon: LayoutDashboard, note: 'আজকের কর্মী-পরিস্থিতি ও KPI' },
  { title: 'Performance', to: '/hr/performance', icon: TrendingUp, note: 'Order Funnel, Task Productivity, Attendance Log' },
  { title: 'Employees', to: '/hr/employees', icon: UserCog, note: 'All Employees, Access Presets, Departments, Designations' },
  { title: 'Payroll', to: '/hr/payroll', icon: DollarSign, note: 'মাসিক পে-রোল ও পেসলিপ' },
  { title: 'Commissions', to: '/hr/commissions', icon: Percent, note: 'অর্ডার-নির্ভর কমিশন নিয়ম' },
  { title: 'Leave', to: '/hr/leave', icon: CalendarDays, note: 'Leave Types, Requests, Balances' },
  { title: 'Attendance', to: '/hr/attendance', icon: CalendarCheck, note: 'Today, Adjustments, Devices, Settings' },
  { title: 'Shifts', to: '/hr/shifts', icon: Clock, note: 'Shift Preset, Rotation, Overtime' },
  { title: 'Settings', to: '/hr/settings', icon: Settings, note: 'উপস্থিতি মোড (APP / MACHINE / BOTH)' },
] as const

const SECTIONS: HelpSection[] = [
  {
    id: 'getting-started',
    title: 'শুরুর আগে (Getting Started)',
    steps: [
      '১. আপনার অ্যাকাউন্টে দিয়ে Admin panel-এ লগ ইন করুন।',
      '২. বাম পাশের Sidebar থেকে HR প্যানেল নির্বাচন করুন।',
      '৩. নিচের "কোন পেজে কী আছে" তালিকা থেকে প্রয়োজনমতো পেজে যান।',
      '৪. কোনো মেনু না পেলে আপনার Permission-এ তা নেই — HR অ্যাডমিনের কাছে অনুরোধ করুন।',
    ],
  },
  {
    id: 'dashboard-tour',
    title: 'ড্যাশবোর্ড কীভাবে পড়বেন (Reading the Dashboard)',
    steps: [
      '১. Workforce Today-তে Present, Working, Break, Absent, Leave, Late ও Missing Checkout দেখা যায়।',
      '২. "Working Now" ও "On Break" সংখ্যা লাইভ — এগুলোতে কোনো cache নেই, সবসময় বর্তমান অবস্থা।',
      '৩. Time অংশে Worked, Break ও Overtime মোট দেখায়।',
      '৪. Order Operations-এর প্রতিটি শতাংশের সাথে গণনা দেখানো থাকে (যেমন ৮০% (৮০ / ১০০)) — শুধু শতাংশ নয়।',
      '৫. Compensation & Payroll অংশটি শুধু "Manage Payroll" permission আছে এমন ব্যবহারকারীকে দেখায়; অন্যরা payroll অংশ পাবেন না।',
    ],
  },
  {
    id: 'shift-presets',
    title: 'শিফট প্রিসেট (Shift Presets)',
    steps: [
      '১. Shifts পেজে গিয়ে একটি Shift Preset তৈরি করুন — নাম, সময় (Start–End) ও Standard Hours।',
      '২. Standard Hours দিলে ঐ সময়টিই ধরা হয়; না দিলে Start–End থেকে বের হবে।',
      '৩. End সময় Start-এর আগে হলে সেটি Overnight শিফট হিসেবে চিহ্নিত হয় — রাতের করা স্বাভাবিকভাবেই গণনা হবে।',
      '৪. কর্মীকে শিফট দিতে: Employees → কর্মীর Edit → Schedule ট্যাব, অথবা Create Employee-এর সময়।',
      '৫. তিনটি পদ্ধতি আছে — Template (একটি প্রিসেট সব দিনে), Rotation (প্রতি বারের আলাদা শিফট), Custom (নির্দিষ্ট সময়)।',
      '৬. Grace Minutes দিলে ততটুকু সময় দেরিতে এলেও সেটি Late ধরা হবে না।',
      '৭. Preset নিষ্ক্রিয় (inactive) করলে নতুন কর্মীকে দেওয়া যাবে না; আগের কর্মীর হিসাব অপরিবর্তিত থাকে।',
    ],
  },
  {
    id: 'overtime-rules',
    title: 'ওভারটাইম কীভাবে হিসাব হয় (How Overtime Is Calculated)',
    steps: [
      '১. ওভারটাইম = কাজ করা সময় − নির্ধারিত সময়, তবে শূন্যের নিচে নামবে না।',
      '২. অর্থাৎ ৮ ঘণ্টার শিফটে ১ ঘণ্টা দেরি করে ঢুকে ১ ঘণ্টা দেরি করে বের হলে ওভারটাইম ০ — কারণ বাড়তি কাজ হয়নি।',
      '৩. ছোট দিন কখনো ওভারটাইম দেয় না, কারণ ঘাটতি ওভারটাইম নয়।',
      '৪. শিফটের সময়সীমার সাথে কোনো ওভারল্যাপ না হলেই সেদিন "Outside Shift" ব্যাজ পড়ে — শিফটের বাইরে কাজ।',
      '৫. শিফট বরাদ্দ না থাকলে ওভারটাইম ও Late কোনোটাই হিসাব হয় না (— দেখাবে)।',
      '৬. ওভারটাইমের বেতন হিসাব এখনো পে-রোলে যায় না — এটি কেবল রিপোর্টিং।',
    ],
  },
  {
    id: 'attendance-modes',
    title: 'উপস্থিতি — APP / MACHINE / BOTH (Attendance)',
    steps: [
      '১. APP মোড: সবাই অ্যাপ/অ্যাডমিন থেকে check-in করে; machine নিষ্ক্রিয়।',
      '২. MACHINE মোড: শুধু ডিভাইস থেকে উপস্থিতি হয়; অ্যাপ check-in বন্ধ।',
      '৩. BOTH মোড: প্রতিটি employee-র method অনুযায়ী (APP বা MACHINE)।',
      '৪. Settings ট্যাব থেকে মোড বদলান — "Manage HR Settings" permission লাগবে।',
      '৫. MACHINE মোডে অ্যাপের উপস্থিতি উইজেট পুরোপুরি লুকিয়ে থাকে, কারণ সেখানে কোনো কাজ করার কিছু নেই।',
      '৬. BOTH মোডে অ্যাপের উইজেট শুধু তখনই দেখাবে, যখন ওই কর্মীর মোড APP।',
      '৭. Any ডিভাইস সংযোগ হলে উপস্থিতি widget-এ live সময় দেখা যায় — এটি পুরো Admin অ্যাপে কাজ করে, HR প্যানেলে সীমাবদ্ধ নয়।',
    ],
  },
  {
    id: 'employee-management',
    title: 'কর্মচারী ব্যবস্থাপনা (Employee Management)',
    steps: [
      '১. Employees → All Employees পেজে যান।',
      '২. Create Employee বাটনে ক্লিক করে নাম, Employee ID, Department, Designation, Attendance Method ও শিফট দিন।',
      '৩. Employee ID খালি রাখলে স্বয়ংক্রিয়ভাবে তৈরি হয়; হাতে দিলে সেটিই ব্যবহার হবে।',
      '৪. Departments ও Designations আগে থেকেই তৈরি রাখুন — নয়তো Create/Edit ফর্মে তালিকা খালি থাকবে।',
      '৫. কর্মীর প্রোফাইলে ৬টি ট্যাব — Overview, Attendance, Tasks, Orders, Leave ও Payroll — সব তথ্য এক জায়গায়।',
      '৬. কারো চাকরি শেষ হলে status পরিবর্তন করুন — ডে-লিস্ট থেকে সরানো লাগবে না, পুরানো হিসাব সংরক্ষিত থাকে।',
    ],
  },
  {
    id: 'access-presets',
    title: 'অ্যাক্সেস প্রিসেট (Access Presets)',
    steps: [
      '১. Employees → Access Presets থেকে permission-এর নির্দিষ্ট সংগ্রহ তৈরি করুন (যেমন "Warehouse Staff")।',
      '২. একটি প্রিসেটে একাধিক permission একসাথে বাঁধা থাকে।',
      '৩. কর্মী তৈরি বা সম্পাদনার সময় Access Preset বেছে নিলে ঐ permissions স্বয়ংক্রিয়ভাবে বসে যায়।',
      '৪. প্রিসেট নিষ্ক্রিয় করলে নতুন কর্মীকে দেওয়া যাবে না; আগের কর্মীর permission অপরিবর্তিত থাকে।',
      '৫. কর্মীর নিজস্ব permission চাইলে সরাসরি Access Preset-এর বদলে সেটি ব্যবহার করুন।',
    ],
  },
  {
    id: 'task-tracking',
    title: 'টাস্ক ও সময় ট্র্যাকিং (Task Time Tracking)',
    steps: [
      '১. টাস্কের সময় অনুমান করা হয় না — শুধু createdAt/updatedAt থেকে ধরা হয় না।',
      '২. কর্মী actually কাজ শুরু করলে timer চালু করে, Pause করলে থামে, Resume করলে আবার চলে।',
      '৩. এক টাস্কে একাধিক work session হতে পারে; প্রতিটি আলাদাভাবে সংরক্ষিত হয়, তাই ভুল হলে সংশোধনযোগ্য।',
      '৪. এক কর্মীর এক টাস্কে একসাথে দুটো timer চলতে পারে না — ডেটাবেজেই এটি বাধািন করা।',
      '৫. Estimated Minutes দিলে actual-এর সাথে তুলনা করা যায়।',
      '৬. "Avg Session Duration" মানে প্রতি কাজের session-এর গড় সময় — পুরো টাস্কের নয়।',
    ],
  },
  {
    id: 'performance-page',
    title: 'পারফরম্যান্স — Order Funnel (Order Performance)',
    steps: [
      '১. Performance পেজে Order Funnel ট্যাবে প্রতিটি কর্মীর order-এর conversion rate দেখা যায়।',
      '২. হিসাবটি current assignee দিয়ে নয় — কোন কর্মী কখন কোন order নিয়ে কাজ করেছে তার ইতিহাস থেকে বের করা হয়।',
      '৩. তাই order পরে অন্য কর্মীর কাছে reassign হলেও আগের কর্মীর performance সঠিক থাকে।',
      '৪. প্রতিটি সংখ্যার পাশে ভাঙার দেখানো থাকে — যেমন ৮০% (৮০ / ১০০)।',
      '৫. যেকোনো সংখ্যায় ক্লিক করলে সেই সংখ্যার আসল order-গুলোর তালিকা (drill-down) খুলবে।',
      '৬. Date range অপরিবর্তিত রাখলে Delivery Rate মানে "এই মাসে confirm করা order-দের পরবর্তী delivery outcome"।',
    ],
  },
  {
    id: 'performance-tasks',
    title: 'পারফরম্যান্স — Task Productivity (Task Productivity)',
    steps: [
      '১. প্রতিটি কর্মীর assigned, completed ও pending টাস্ক দেখা যায়।',
      '২. সর্বোচ্চ কমলাইনের হিসাব পুরো ফলাফলের — এক পাতা বদলালেও সেটি বদলায় না।',
      '৩. কোনো টাস্ক না থাকলে completion rate-এর বদলে "—" দেখানো হয়, কারণ তখন rate-এর কোনো অর্থ নেই।',
      '৪. "Assigned" হিসাব হয় কখন টাস্কটি তৈরি হয়েছে, আর "Completed" হিসাব হয় কখন শেষ হয়েছে — দুটির তারিখ ভিন্ন হতে পারে।',
    ],
  },
  {
    id: 'date-ranges',
    title: 'তারিখ ও ফিল্টার (Date Ranges & Filters)',
    steps: [
      '১. Today, Yesterday, This Week, This Month, Last 30 Days ও Custom — সবগুলো ঢাকার ক্যালেন্ডার দিন অনুযায়ী হিসাব করে।',
      '২. সকাল ৬টার আগে "Today" আগের দিন দেখাবে না — সবসময় ঢাকার তারিখ ধরা হয়।',
      '৩. Business week শনিবার থেকে শুরু হয়, যেমনটি attendance-এর weekly off-এর সাথে মেলে।',
      '৪. Department ও Employee দিয়ে আরও ছোট করে দেখা যায়।',
      '৫. Date ও ফিল্টার একসাথে কাজ করে — দুটোই ব্যবহার করলে দুটোই প্রয়োগ হবে।',
    ],
  },
  {
    id: 'salary-payroll',
    title: 'বেতন ও পে-রোল (Salary & Payroll)',
    steps: [
      '১. Employees → কর্মচারীর Compensation ট্যাবে Salary Structure সেট করুন।',
      '২. Payroll পেজ থেকে মাস নির্বাচন করে Run Payroll চাপুন।',
      '৩. Payslips অটো তৈরি হয় — employee নিজে storefront-এর My HR থেকে দেখতে পায়।',
      '৪. ভুল বেতন দেখালে সংশোধন করে আবার run করুন; history সংরক্ষিত থাকে।',
      '৫. Payroll দেখা ও চালানোর জন্য আলাদা permission লাগে; শুধু HR দেখলেই বেতন দেখা যায় না।',
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
      '৫. অর্ডার refund বা cancel হলে কমিশন অটো রিভার্স হয় — partial refund হলে আনুপাতিক, full cancel হলে পুরো।',
      '৬. পেসলিপ approved হলে পরে কমিশন রিভার্স হয় না — তাই পে-রোল run এর আগে সব অর্ডার settle করুন।',
    ],
  },
  {
    id: 'leave',
    title: 'ছুটি (Leave)',
    steps: [
      '১. Leave পেজে তিনটি ট্যাব — Leave Types (প্রতি বছরে কত দিন), Requests ও Balances।',
      '২. Employee storefront-এর My HR → Leave থেকে আবেদন করে।',
      '৩. Admin Leave Requests ট্যাবে Approve বা Reject করুন।',
      '৪. Balance অটো আপডেট হয় — ছুটি কাটলে পে-রোলে হিসাব হবে।',
      '৫. কর্মীর প্রোফাইলের Leave ট্যাবে balance, history ও আসন্ন ছুটি দেখা যায়।',
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
      '৫. "Unmapped" ব্যাজ মানে ডিভাইসের ইভেন্ট কোনো employee-র সাথে ম্যাপ হয়নি — Mappings-এ ম্যাপিং করে আবার Sync চাপুন।',
    ],
  },
  {
    id: 'my-hr',
    title: 'My HR (কর্মচারী সেলফ-সার্ভিস)',
    steps: [
      '১. Storefront-এ লগ ইন করে Account → My HR খুলুন।',
      '২. Profile, Salary, Payslips, Leave ও Attendance নিজে দেখুন।',
      '৩. Attendance ট্যাব থেকে নিজের Check In / Break / Check Out করুন (নিজের মোড APP হলে)।',
      '৪. Leave আবেদন, payslip ডাউনলোড — সব এক জায়গায়।',
      '৫. ব্লক করা নম্বর (blocked phone) দিয়ে checkout করলে ব্যবস্থা নিতে checkout popup আসবে — অন্য নম্বর ব্যবহার করুন।',
    ],
  },
  {
    id: 'attendance-corrections',
    title: 'উপস্থিতি সংশোধন (Corrections & Missing Checkout)',
    steps: [
      '১. ভুলে check-in করলে বা remote work হলে Adjustments ট্যাবের "Add Day" দিয়ে employee, তারিখ, স্ট্যাটাস ও কারণ দিন।',
      '২. "Manage Attendance Adjustments" permission ছাড়া এই বাটন দেখাবে না।',
      '৩. "Missing Checkout" ব্যাজ মানে session এখনো খোলা — Today ট্যাবে "Close Session" চেপে সময় রেকর্ড করুন।',
      '৪. মিসিং checkout রেপোর্ট ও পে-রোলে হিসাব ভুল করতে পারে — তাই সময়মতো সমাধান করুন।',
      '৫. হাতে করে স্ট্যাটাস বদলালে সেটিই চূড়ান্ত — স্বয়ংক্রিয় Late গণনায় প্রভাব ফেলে না।',
    ],
  },
  {
    id: 'glossary',
    title: 'পরিভাষা তালিকা (Glossary)',
    steps: [
      'Attendance = উপস্থিতি — কর্মচারীর কাজের হাজিরা',
      'Session = সেশন — check-in থেকে checkout পর্যন্ত সময়কাল',
      'Punch = পাঞ্চ — ডিভাইসে হাজিরা নির্দেশক ইভেন্ট',
      'Shift Preset = শিফট প্রিসেট — পুনর্ব্যবহারযোগ্য কাজের সময়ের ছক',
      'Rotation = রোটেশন — সপ্তাহের প্রতিদিন আলাদা শিফট',
      'Scheduled Minutes = নির্ধারিত সময় — শিফট অনুযায়ী ওভারটাইমের মাপকাঠি',
      'Overtime = অতিরিক্ত কাজ — নির্ধারিতের বেশি (শূন্যের নিচে নামে না)',
      'Outside Shift = শিফটের বাইরে কাজ — শিফটের সাথে কোনো ওভারল্যাপ ছিল না',
      'Grace Period = ছাড়ের সময় — এতটুকু দেরি এলেও Late ধরা হয় না',
      'Commission = কমিশন — অর্ডার নির্ভর বোনাস',
      'Void = বাতিল — পেমেন্ট বা লেনদেন অচল করা (audit trail সংরক্ষিত)',
      'Rehire = পুনর্নিয়োগ — পদত্যাগকারী employee-কে আবার নিয়োগ দেওয়া',
    ],
  },
  {
    id: 'troubleshooting',
    title: 'সমস্যা সমাধান (Troubleshooting)',
    steps: [
      '❌ "Session expired" → আবার sign in করুন।',
      '❌ "403 Forbidden" → আপনার role permission পরীক্ষা করুন।',
      '❌ মেনু নেই → Permission নেই; HR অ্যাডমিনের কাছে অনুরোধ করুন।',
      '❌ "No employee record" → আগে Employee তৈরি করুন।',
      '❌ বেতন দেখা যাচ্ছে না → "Manage Payroll" permission লাগবে।',
      '❌ Overtime ০ দেখাচ্ছে → কর্মীর শিফট বরাদ্দ আছে কিনা দেখুন; শিফট না থাকলে হিসাব হয় না।',
      '❌ ওভারটাইম এলেও বেতনে যোগ হয়নি → এটি এখনো শুধু রিপোর্টিং; বেতন হিসাব আলাদাভাবে করতে হবে।',
      '❌ Completion rate বদলে গেল → এটি সম্ভব হওয়ার কথা নয়; রিপোর্ট করুন।',
      '❌ "Missing checkout badge" → Today ট্যাবে Close Session ব্যবহার করুন।',
      '❌ "Unmapped events" → Devices → Mappings-এ নতুন ম্যাপিং তৈরি করে আবার Sync।',
      '❌ "409 Overlapping leave" → আগের leave request cancel করে নতুন করুন।',
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

        {/* Where everything lives — mirrors sidebar-data.ts so the guide cannot
            drift from the real navigation. */}
        <Card>
          <CardHeader>
            <CardTitle>কোন পেজে কী আছে (Page Guide)</CardTitle>
            <CardDescription>প্রতিটি মেনুতে সরাসরি ক্লিক করে যান।</CardDescription>
          </CardHeader>
          <CardContent className='grid gap-2 sm:grid-cols-2 lg:grid-cols-3'>
            {PAGES.map((page) => (
              <Link
                key={page.to}
                to={page.to}
                className='flex items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50'
              >
                <page.icon className='mt-0.5 h-4 w-4 shrink-0 text-muted-foreground' />
                <div className='min-w-0'>
                  <p className='text-sm font-semibold'>{page.title}</p>
                  <p className='text-xs text-muted-foreground'>{page.note}</p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

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

        <p className='flex items-start gap-2 text-xs text-muted-foreground'>
          <ShieldCheck className='mt-0.5 h-3.5 w-3.5 shrink-0' />
          <span>
            এই গাইডে বর্ণিত হিসাবের সূত্র কোডের হিসাবের সাথে হুবহু মেলে। সন্দেহ হলে Attendance ও
            Performance পেজের সংখ্যাগুলোই নির্ভরযোগ্য উত্তর — গাইড কেবল ব্যাখ্যা করে।
          </span>
        </p>
      </Main>
    </>
  )
}