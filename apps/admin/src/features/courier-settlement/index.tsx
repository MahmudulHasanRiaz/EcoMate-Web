import { useState } from 'react'
import { Wallet } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Header } from '@/components/layout/header'
import { Main } from '@/components/layout/main'
import { GlobalSearchBar } from '@/components/global-search-bar'
import { ThemeSwitch } from '@/components/theme-switch'
import { ProfileDropdown } from '@/components/profile-dropdown'
import { PageInfo } from '@/components/page-info'
import { OverviewPanel } from './overview-panel'
import { InvoicesTable } from './invoices-table'
import { ReconciliationPanel } from './reconciliation-panel'
import { ExceptionsPanel } from './exceptions-panel'
import { BalancesPanel } from './balances-panel'
import { SettingsPanel } from './settings-panel'
import { ImportWizard } from './import-wizard'

/**
 * Courier settlement workspace (§10). Read-model only: every figure traces to a
 * finalized settlement row, so the screen never re-derives totals and never
 * renders a guessed zero where no document exists.
 *
 * Tabs follow the operator's mental order: state (Overview) → documents
 * (Invoices) → per-invoice health (Reconciliation) → what we owe / are owed
 * (Balances) → the work queue (Exceptions) → versioned rules (Rules).
 */
export function CourierSettlementPage() {
  const [importOpen, setImportOpen] = useState(false)
  const [resumeDraftId, setResumeDraftId] = useState<string | null>(null)

  return (
    <>
      <Header fixed>
        <GlobalSearchBar className="me-auto" />
        <ThemeSwitch />
        <ProfileDropdown />
      </Header>
      {/* This page used to render a bare div with no <Main> — the app shell
          gives pages no padding of its own, so every card sat flush
          against the viewport edges (owner report, 2026-11-02). */}
      <Main className="flex flex-col gap-4 sm:gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="chart-card-header-icon bg-success-soft text-success border border-success/25">
            <Wallet className="size-5" aria-hidden />
          </span>
          <div className="flex items-center gap-1.5">
            <h1 className="text-2xl font-semibold tracking-tight">
              Courier Settlement
            </h1>
          </div>
        </div>
        <Button
          className="tap-h"
          onClick={() => {
            setResumeDraftId(null)
            setImportOpen(true)
          }}
        >
          Import
        </Button>
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="tap-h h-auto max-w-full flex-wrap overflow-x-auto no-scrollbar">
          <TabsTrigger value="overview" className="tap-h">Overview</TabsTrigger>
          <TabsTrigger value="invoices" className="tap-h">Invoices</TabsTrigger>
          <TabsTrigger value="reconciliation" className="tap-h">Reconciliation</TabsTrigger>
          <TabsTrigger value="balances" className="tap-h">Balances</TabsTrigger>
          <TabsTrigger value="exceptions" className="tap-h">Exceptions</TabsTrigger>
          <TabsTrigger value="settings" className="tap-h">Rules</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <OverviewPanel />
        </TabsContent>
        <TabsContent value="invoices" className="mt-4">
          <InvoicesTable
            onResumeDraft={(id) => {
              setResumeDraftId(id)
              setImportOpen(true)
            }}
          />
        </TabsContent>
        <TabsContent value="reconciliation" className="mt-4">
          <ReconciliationPanel />
        </TabsContent>
        <TabsContent value="balances" className="mt-4">
          <BalancesPanel />
        </TabsContent>
        <TabsContent value="exceptions" className="mt-4">
          <ExceptionsPanel />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <SettingsPanel />
        </TabsContent>
      </Tabs>

      <ImportWizard
        open={importOpen}
        onOpenChange={setImportOpen}
        initialDraftId={resumeDraftId}
      />
      </Main>
    </>
  )
}
