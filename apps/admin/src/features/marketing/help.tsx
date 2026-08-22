import { useState } from 'react'
import { HelpCircle, Link2, Wallet, Target, BarChart3, Settings, AlertTriangle, CheckCircle2, ChevronRight, ExternalLink } from 'lucide-react'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { ThemeSwitch } from '@/components/theme-switch'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Link } from '@tanstack/react-router'

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{n}</div>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="text-sm text-muted-foreground leading-relaxed">{children}</div>
      </div>
    </div>
  )
}

function ConfigRow({ label, desc, example }: { label: string; desc: string; example?: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <div className="flex items-center gap-2">
        <code className="text-xs font-mono bg-muted px-1.5 py-0.5 rounded">{label}</code>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
      {example && <p className="mt-1 text-xs text-muted-foreground">উদাহরণ: <code className="font-mono">{example}</code></p>}
    </div>
  )
}

function TokenGuide({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div className="rounded-lg border bg-muted/30">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-primary hover:bg-muted/60 transition-colors"
      >
        <ChevronRight className={`h-4 w-4 shrink-0 transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
        <span>Access Token কীভাবে পাবেন? (Facebook for Developers)</span>
      </button>
      {open && (
        <div className="space-y-3 border-t px-4 py-3 text-sm text-muted-foreground">
          <Step n={1} title="developers.facebook.com এ যান">
            <p>ব্রাউজারে <code className="font-mono text-xs bg-muted px-1 rounded">https://developers.facebook.com</code> খুঁজুন।</p>
            <p>আপনার Facebook account দিয়ে login করুন।</p>
          </Step>
          <Step n={2} title="App তৈরি করুন (থাকলে এড়িয়ে যান)">
            <p>"My Apps" → "Create App" → "Business" type select করুন।</p>
            <p>App name দিন (যেমন "EcoMate Marketing") → "Create App"।</p>
            <p className="text-xs">ইতিমধ্যে app থাকলে এই স্টেপ এড়িয়ে যান।</p>
          </Step>
          <Step n={3} title="App Settings এ যান">
            <p>App Dashboard থেকে "Settings" → "Basic" এ যান।</p>
            <p>নিচে "App ID" এবং "App Secret" copy করুন।</p>
            <p className="text-xs">এগুলো EcoMate Settings-এ <code className="font-mono text-xs bg-muted px-1 rounded">marketing_app_id</code> এবং <code className="font-mono text-xs bg-muted px-1 rounded">marketing_app_secret</code> হিসেবে দিন।</p>
          </Step>
          <Step n={4} title="Access Token তৈরি করুন">
            <p>"Tools" → "Graph API Explorer" এ যান।</p>
            <p>ডানদিকের dropdown থেকে আপনার App select করুন।</p>
            <p>"Generate Access Token" ক্লিক করুন।</p>
          </Step>
          <Step n={5} title="Permission দিন">
            <p>Popup-এ <code className="font-mono text-xs bg-muted px-1 rounded">ads_read</code> permission খুঁজে দিন।</p>
            <p>শুধু <strong className="text-foreground">ads_read</strong> দিন — অন্য কোনো permission দরকার নেই।</p>
            <p>"Generate Token" ক্লিক করুন।</p>
          </Step>
          <Step n={6} title="Token copy করে Connections পেজে দিন">
            <p>তৈরি হওয়া token copy করুন (লম্বা string, যেমন <code className="font-mono text-xs bg-muted px-1 rounded">EAAGm0P...</code>)।</p>
            <p>এখন EcoMate-এ <strong className="text-foreground">Connections</strong> পেজে গিয়ে "Add connection" এ এই token paste করুন।</p>
            <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-700 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <div>
                <p><strong>গুরুত্বপূর্ণ:</strong> Token default ১-২ দিনে expire হয়। দীর্ঘমেয়াদী token পেতে:</p>
                <p className="mt-1">Settings → "Token" সেকশনে "Extend Access Token" ক্লিক করুন। এতে ৬০ দিনের token পাবেন।</p>
                <p className="mt-1">তারপর EcoMate Settings-এ <code className="font-mono">marketing_app_id</code> + <code className="font-mono">marketing_app_secret</code> দিন — তাহলে token auto-refresh হবে।</p>
              </div>
            </div>
          </Step>
        </div>
      )}
    </div>
  )
}

export function MarketingHelp() {
  const [tokenOpen, setTokenOpen] = useState(false)
  return (
    <>
      <Header fixed>
        <div className="flex items-center gap-2">
          <HelpCircle className="h-5 w-5" />
          <h1 className="text-lg font-semibold">Marketing Attribution — সাহায্য</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Link to="/op/marketing">
            <Badge variant="outline" className="cursor-pointer hover:bg-muted">ড্যাশবোর্ডে ফিরুন</Badge>
          </Link>
          <ThemeSwitch />
          <ProfileDropdown />
        </div>
      </Header>
      <Main>
        <div className="mx-auto max-w-3xl space-y-6">

          {/* কী এটা */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Marketing Attribution কী?</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>আপনার Meta, TikTok বা অন্য যেকোনো ad platform এ যখন campaign চালান, তখন EcoMate অটোমেটিকলি কোন order কোন campaign থেকে এসেছে তা track করে।</p>
              <p><strong className="text-foreground">ফলাফল:</strong> প্রতিটি campaign-এ কত টাকা খরচ হয়েছে, কত টাকা revenue এসেছে, এবং কত profit হয়েছে — সব এক জায়গায় দেখবেন।</p>
              <p className="text-xs">Dashboard-এ <strong>verdict badge</strong> (Profitable / Near break-even / Loss-making) এবং <strong>break-even CPA</strong> সরাসরি দেখতে পাবেন।</p>
            </CardContent>
          </Card>

          {/* সেটআপ */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4" /> সেটআপ (প্রথমবার)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Step n={1} title="Connect an Ad Platform (Meta / TikTok / Google)">
                <p>সাইডবার থেকে <strong>Connections</strong> এ যান। "Add connection" ক্লিক করুন।</p>
                <p>আপনার ad platform-এর access token দিন। Token এর মাধ্যমে EcoMate আপনার ad data পড়বে।</p>
                <TokenGuide open={tokenOpen} onToggle={() => setTokenOpen(!tokenOpen)} />
                <p className="text-xs"><strong>গুরুত্বপূর্ণ:</strong> Token শুধু <code>ads_read</code> permission দরকার। EcoMate কোনো post করবে না।</p>
              </Step>
              <Step n={2} title="Sync Ad Accounts">
                <p><strong>Ad Accounts</strong> পেজে যান। "Sync an account" ক্লিক করুন।</p>
                <p>আপনার Facebook Ad Account select করুন। Sync হলে সব campaign + daily insights automatically আসবে।</p>
              </Step>
              <Step n={3} title="Funding যোগ করুন (ঐচ্ছিক)">
                <p><strong>Funding</strong> পেজে যান। প্রতিটি ad account-এ কত টাকা খরচ করেছেন তা লিখুন।</p>
                <p>এটা হিসাব রাখার জন্য — আপনার বাস্তব ব্যাংক/বিকাশ থেকে কত টাকা ad account-এ দিয়েছেন।</p>
              </Step>
              <Step n={4} title="Attribution check করুন">
                <p><strong>Attribution</strong> পেজে যান। এখানে দেখবেন কোন order কোন campaign থেকে এসেছে।</p>
                <p>Order confirm হলে EcoMate automatically order-কে campaign-এর সাথে match করবে।</p>
              </Step>
            </CardContent>
          </Card>

          {/* কীভাবে কাজ করে */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="h-4 w-4" /> কীভাবে কাজ করে
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                <p><strong className="text-foreground">Step 1:</strong> Customer আপনার ad দেখে website-এ আসে। Click ID (fbclid/ttclid), UTM/tracking data EcoMate-তে store হয়।</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                <p><strong className="text-foreground">Step 2:</strong> Customer order দেখান। Order confirm হলে system automatically campaign match করে (session → click ID → UTM — প্রথম match জিতে)।</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                <p><strong className="text-foreground">Step 3:</strong> Campaign spending + attributed revenue মিলিয়ে profit, gross margin এবং break-even CPA calculate হয়।</p>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-emerald-500 shrink-0" />
                <p><strong className="text-foreground">Step 4:</strong> Dashboard-এ verdict badge (Profitable / Near break-even / Loss-making), ROI, CAC সহ সব analytics দেখুন।</p>
              </div>
            </CardContent>
          </Card>

          {/* কনফিগারেশন */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Settings className="h-4 w-4" /> কনফিগারেশন রেফারেন্স
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <ConfigRow
                label="Product cost allocation mode"
                desc="প্রতিটি product-এ campaign cost কীভাবে ভাগ করবে।"
                example="product_value | equal | quantity"
              />
              <ConfigRow
                label="Sync interval"
                desc="Ad platform থেকে কত ঘণ্টা পর পর data sync হবে।"
                example="marketing_sync_interval_hours (default: 6)"
              />
              <ConfigRow
                label="Meta App credentials"
                desc="Token refresh-এর জন্য। না দিলেও চলবে, তবে token expire হলে নিজে refresh হবে না।"
                example="marketing_app_id + marketing_app_secret (Settings থেকে)"
              />
              <ConfigRow
                label="FIFO consumption"
                desc="Prepaid credit কখন খরচ হবে — Promotional credit আগে খরচ হয়, তারপর Paid credit।"
                example="Promotional credit consumed first (platform standard)"
              />
              <ConfigRow
                label="Prepaid account"
                desc="Ad Account-এর জন্য auto-created asset account — funding এবং consumption এর মধ্যে bridge হিসেবে কাজ করে।"
                example="Dr Marketing Prepaid / Cr Funding Account (funding confirm করলে)"
              />
              <ConfigRow
                label="Campaign deletion"
                desc="Provider থেকে campaign delete হলেও EcoMate-এ local data ও historical records সংরক্ষিত থাকবে।"
                example="Soft delete only — local records preserved"
              />
            </CardContent>
          </Card>

          {/* পেজ গাইড */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4" /> পেজ গাইড
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="grid gap-2 sm:grid-cols-2">
                <Link to="/op/marketing" className="rounded-md border px-3 py-2 hover:bg-muted transition-colors">
                  <p className="font-medium">Dashboard</p>
                  <p className="text-xs text-muted-foreground">Verdict, break-even CPA, gross margin, financial position — সব কিছুর সারসংক্ষেপ</p>
                </Link>
                <Link to="/op/marketing/connections" className="rounded-md border px-3 py-2 hover:bg-muted transition-colors">
                  <p className="font-medium">Connections</p>
                  <p className="text-xs text-muted-foreground">Ad platform connect করুন (Meta token)</p>
                </Link>
                <Link to="/op/marketing/ad-accounts" className="rounded-md border px-3 py-2 hover:bg-muted transition-colors">
                  <p className="font-medium">Ad Accounts</p>
                  <p className="text-xs text-muted-foreground">Sync করা ad accounts দেখুন ও নতুন যোগ করুন</p>
                </Link>
                <Link to="/op/marketing/campaigns" className="rounded-md border px-3 py-2 hover:bg-muted transition-colors">
                  <p className="font-medium">Campaigns</p>
                  <p className="text-xs text-muted-foreground">সব campaigns — status, spend, attributed orders</p>
                </Link>
                <Link to="/op/marketing/funding" className="rounded-md border px-3 py-2 hover:bg-muted transition-colors">
                  <p className="font-medium">Funding</p>
                  <p className="text-xs text-muted-foreground">Ad account-এ কত টাকা দিয়েছেন তা রেকর্ড করুন</p>
                </Link>
                <Link to="/op/marketing/attribution" className="rounded-md border px-3 py-2 hover:bg-muted transition-colors">
                  <p className="font-medium">Attribution</p>
                  <p className="text-xs text-muted-foreground">কোন order কোন campaign থেকে এসেছে</p>
                </Link>
                <Link to="/op/marketing/reports" className="rounded-md border px-3 py-2 hover:bg-muted transition-colors">
                  <p className="font-medium">Reports</p>
                  <p className="text-xs text-muted-foreground">ROI, CAC, CPP — analytics ও summaries</p>
                </Link>
                <Link to="/op/marketing/spend-snapshots" className="rounded-md border px-3 py-2 hover:bg-muted transition-colors">
                  <p className="font-medium">Spend Snapshots</p>
                  <p className="text-xs text-muted-foreground">দৈনিক product-level cost breakdown</p>
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* সমস্যা */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> সাধারণ সমস্যা
              </CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-3">
              <div>
                <p className="font-medium text-foreground">Campaigns দেখাচ্ছে না</p>
                <p>Connections পেজে Meta token আছে কিনা দেখুন। Token expire হলে নতুন token দিন। Ad Accounts পেজে sync status check করুন।</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Funding P&L-তে দেখাচ্ছে না</p>
                <p>Funding confirm করুন — তাহলে journal entry auto-create হবে (Dr Marketing Prepaid / Cr Funding Account)। Promotional credit আলাদভাবে track হয়, P&L খরচে গণনা হয় না।</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Token expire হয়ে গেছে</p>
                <p>Meta token ৬০ দিনের বেশি স্থায়ী হয় না। Settings এ <code>marketing_app_id</code> + <code>marketing_app_secret</code> দিলে auto-refresh হবে। নাহলে Connections পেজে নতুন token দিন।</p>
              </div>
              <div>
                <p className="font-medium text-foreground">Attribution খালি / অসম্পূর্ণ</p>
                <p>Order confirm হয়েছে কিনা দেখুন। শুধু Pending orders match হবে না। Click ID / UTM / session — প্রথম match জিতে, পরবর্তী overwrite হয় না। "Recalculate" চাপুন।</p>
              </div>
            </CardContent>
          </Card>

        </div>
      </Main>
    </>
  )
}
