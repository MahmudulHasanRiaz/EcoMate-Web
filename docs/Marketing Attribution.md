# SPEC-001 - Marketing Attribution Platform
## Facebook Ads Integration, Marketing Cost Attribution & Profit Intelligence Engine

**Version:** 1.0 (Draft)
**Status:** Architecture Design
**Author:** ChatGPT (Architecture Session)
**Target Stack:**
- Backend: Fastify + NestJS
- Storefront: Next.js
- Admin: React SPA + TanStack Router
- Database: PostgreSQL + Prisma ORM
- Queue: BullMQ
- Cache: Redis

---

# Background

Modern eCommerce businesses rely heavily on paid advertising platforms such as Facebook Ads to acquire customers. While Facebook Ads Manager provides campaign-level analytics, it does not provide business-level financial intelligence.

Business owners typically need answers to questions such as:

- Which products are actually profitable after advertising cost?
- Which orders generated profit or loss?
- Which campaigns are wasting money?
- What is the actual marketing cost per product?
- Which ad generated the highest net profit?
- How much advertising cost has already been consumed from previously purchased ad credits?
- Which bank account or card funded those advertising expenses?
- How should foreign currency advertising expenses be reflected inside accounting?

Unfortunately, these answers cannot be obtained from Facebook Ads Manager alone.

Likewise, a traditional ERP system usually knows:

- Products
- Inventory
- Orders
- Payments
- Accounting

but has no understanding of:

- Campaigns
- Ad Sets
- Ads
- Clicks
- Marketing Attribution
- Advertising Spend

This creates a major visibility gap between Marketing and Finance.

The objective of this module is not to replace Facebook Ads Manager.

Instead, this module introduces a Marketing Attribution Platform capable of connecting marketing performance with financial accounting, inventory, order management and profitability analysis.

The platform will synchronize advertising data from Facebook while using ERP as the financial source of truth.

The final outcome enables businesses to understand the complete customer acquisition lifecycle:

Facebook Ad
↓

Customer Visit

↓

Website Session

↓

Order

↓

Products

↓

Accounting

↓

Profit & Loss

↓

Business Intelligence

---

# Vision

Build an enterprise-grade Marketing Attribution Platform that allows businesses to measure advertising performance using actual accounting data instead of estimated values.

The platform must become the financial intelligence layer between digital marketing and ERP.

Future integrations should require minimal architectural changes.

Supported platforms should eventually include:

- Facebook Ads
- Instagram Ads
- Google Ads
- TikTok Ads
- LinkedIn Ads
- WooCommerce
- Shopify
- Custom Stores
- Mobile Applications
- Offline Sales

---

# Objectives

The system should achieve the following objectives.

## Marketing Visibility

Provide complete visibility of:

- Campaign performance
- Ad Set performance
- Ad performance
- Spend trends
- Purchase trends
- ROAS
- CPC
- CPM
- CTR
- Conversion metrics

without requiring users to visit Facebook Ads Manager.

---

## Financial Visibility

Allow businesses to understand:

- Actual marketing expenses
- Foreign currency spending
- Effective exchange rate
- Advertising payment history
- Cost allocation
- Campaign profitability
- Product profitability
- Order profitability

using ERP accounting data.

---

## Attribution Intelligence

Accurately connect:

Facebook

↓

Campaign

↓

Ad

↓

Website Visit

↓

Customer Session

↓

ERP Order

↓

Products

↓

Profit Analysis

---

## Explainable Profit

Every profit calculation should be explainable.

Users should never see:

Profit = 2,000 BDT

without understanding:

Why?

Instead the ERP should explain:

Revenue

↓

COGS

↓

Shipping

↓

Marketing Cost

↓

Currency Conversion

↓

Accounting Ledger

↓

Net Profit

---

## Automation First

The system should automatically determine marketing attribution whenever reliable data exists.

Manual mapping should only be used as the final fallback.

---

# Design Philosophy

The platform follows several core architectural principles.

---

## Principle 1

Financial Accuracy First

Marketing reports are useful.

Financial reports must be correct.

Whenever reporting and accounting disagree, accounting must remain the source of truth.

---

## Principle 2

Source Data Never Changes

The following information is considered immutable:

- Facebook Spend
- Payment Ledger
- Orders
- Order Items
- Accounting Entries
- Attribution Events

Derived reports can always be recalculated.

Source data cannot.

---

## Principle 3

Marketing Cost is Derived

Marketing Cost is never permanently stored as truth.

Instead it is derived from:

Facebook Spend

+

Dollar Ledger

+

Order Attribution

+

Allocation Rules

This allows recalculation whenever better information becomes available.

---

## Principle 4

Explain Every Number

Every calculated value inside the ERP should have an explanation.

Example:

Marketing Cost

↓

Derived From

↓

Campaign

↓

Ad

↓

Dollar Ledger

↓

FIFO Allocation

↓

Exchange Rate

↓

Accounting Voucher

Users should never question how a number was generated.

---

## Principle 5

Automation Before Manual Work

The system attempts automatic attribution using:

1. Click Tracking
2. FBCLID
3. Meta Pixel
4. Conversion API
5. Session Tracking
6. Order Attribution

Only if attribution cannot be resolved will manual mapping be requested.

---

## Principle 6

Platform Agnostic Architecture

The attribution engine should not know anything specific about Facebook.

Instead it should support multiple marketing platforms.

Example:

Marketing Source

↓

Campaign

↓

Traffic

↓

Orders

↓

Products

↓

Accounting

↓

Profit

Facebook is simply the first implementation.

---

## Principle 7

Loose Coupling

Marketing modules must communicate through events.

Never through direct service dependencies.

This allows:

Facebook Module

Google Module

TikTok Module

Shopify Module

to evolve independently.

---

## Principle 8

Incremental Computation

The platform should never recalculate the entire database after every update.

Instead it should:

Detect Change

↓

Identify Impact

↓

Mark Dirty

↓

Queue Jobs

↓

Recalculate Only Affected Records

---

## Principle 9

Enterprise Auditability

Every important action must be traceable.

Examples:

Who connected an Ad Account?

Who paused a Campaign?

Who entered Dollar Rate?

Which Payment funded this Spend?

Which Allocation Rule generated this Product Cost?

Which Algorithm calculated this Profit?

Every answer should be available through Audit Logs.

---

## Principle 10

User Experience Before Complexity

Although the platform contains sophisticated financial logic, the user interface should remain simple.

Instead of exposing accounting terminology, the system should guide users using business-friendly language.

Configuration should use:

- Setup Wizards
- Recommendations
- Tooltips
- Examples
- Visual Guidance

instead of technical configuration screens.

---

# Requirements

The project follows the MoSCoW prioritization model.

---

# MUST HAVE

## Facebook Integration

- Connect Facebook Business
- Connect multiple Ad Accounts
- OAuth Authentication
- Token Management
- Automatic Token Refresh
- Webhook Registration
- Historical Import
- Incremental Synchronization

---

## Campaign Synchronization

Automatically synchronize:

- Campaigns
- Ad Sets
- Ads
- Status
- Budget
- Spend
- Purchases
- Purchase Value
- Reach
- Clicks
- Impressions
- CTR
- CPC
- CPM
- ROAS

---

## Campaign Management

Allow users to:

- Pause Campaign
- Resume Campaign
- View Status
- View Hierarchy

Campaign creation is intentionally outside MVP scope.

---

## Marketing Accounting

Provide:

- Dollar Payment Ledger
- Payment Source
- Bank/Card Mapping
- Wallet Mapping
- Effective Exchange Rate
- Accounting Voucher Link
- FIFO Dollar Consumption

---

## Marketing Attribution

Automatically connect:

Campaign

↓

Ad

↓

Customer Session

↓

Order

↓

Products

---

## Profit Analysis

Generate:

- Campaign Profit
- Product Profit
- Order Profit
- Marketing ROI
- Marketing Cost
- Actual Advertising Expense

---

## Configurable Cost Allocation

Support configurable allocation methods.

Examples:

- Equal Order Allocation
- Product Value Allocation
- Quantity Allocation
- Future Custom Rules

---

## Analytics

Provide:

- Campaign Dashboard
- Product Dashboard
- Order Dashboard
- Marketing Dashboard
- Spend Dashboard

---

## SHOULD HAVE

(To be continued in Part 2...)


# SHOULD HAVE

## Marketing Intelligence

The platform should provide:

- Marketing Cost Trend
- ROAS Trend
- Product Profit Trend
- Customer Acquisition Cost (CAC)
- Cost Per Purchase (CPP)
- Marketing ROI Timeline
- Attribution Confidence
- Explain Profit

---

## Accounting Integration

The platform should integrate with ERP Accounting by linking:

- Payment Vouchers
- Bank Accounts
- Card Accounts
- Wallet Accounts
- Journal Entries
- Ledger Transactions

---

## Historical Analytics

Support historical reports including:

- Daily
- Weekly
- Monthly
- Quarterly
- Yearly

Reports should remain available even after campaigns have ended.

---

## Snapshot Reporting

Provide optimized snapshot reports for:

- Daily Campaign Summary
- Daily Product Cost
- Daily Profit
- Daily Marketing Expense

without recalculating the entire database.

---

# COULD HAVE

- Google Ads Integration
- TikTok Ads Integration
- LinkedIn Ads Integration
- Offline Conversion Import
- AI Marketing Insights
- Budget Recommendation
- Campaign Anomaly Detection
- Marketing Forecasting
- Predictive ROAS

---

# WON'T HAVE (MVP)

The following features are intentionally excluded.

- Facebook Campaign Builder
- Facebook Creative Builder
- Audience Builder
- Image Upload
- Video Upload
- Facebook Pixel Creation
- Full Facebook Ads Manager Replacement

Campaigns will continue to be created from Meta Ads Manager.

ERP will automatically synchronize them.

---

# High Level Architecture

The platform consists of multiple independent domains.

Each domain owns its own business logic.

Communication happens through Events.

No module should directly depend on another module's implementation.

```

```text
                             ┌────────────────────────────┐
                             │ Facebook Graph API         │
                             └─────────────┬──────────────┘
                                           │
                                           │ OAuth
                                           │ Webhooks
                                           │ Insights
                                           ▼
                         ┌────────────────────────────────────┐
                         │ Facebook Integration Module        │
                         └────────────────────────────────────┘
                                           │
                                           │ Events
                                           ▼
                 ┌─────────────────────────────────────────────┐
                 │ Marketing Attribution Platform              │
                 └─────────────────────────────────────────────┘
                          │            │              │
                          │            │              │
                          ▼            ▼              ▼

                 Attribution      Marketing      Analytics
                   Engine         Accounting      Engine

                          │            │              │
                          └──────┬─────┴─────┬────────┘
                                 ▼
                         Profit Intelligence

                                 │
                                 ▼

                           ERP Reporting
```

---

# Architecture Layers

The system is divided into six logical layers.

---

## Layer 1

Integration Layer

Responsibilities

- OAuth
- Token Management
- Webhook Processing
- Facebook API Calls
- Retry Logic
- Rate Limiting
- Historical Sync
- Incremental Sync

This layer knows Facebook.

Nothing else.

---

## Layer 2

Synchronization Layer

Responsibilities

Receive raw Facebook objects.

Examples:

- Businesses
- Ad Accounts
- Campaigns
- Ad Sets
- Ads
- Insights

Normalize the data.

Store raw objects.

Publish events.

This layer never calculates profit.

---

## Layer 3

Marketing Accounting

Responsibilities

Manage advertising money.

Includes:

- Dollar Ledger
- Payment Ledger
- Exchange Rates
- FIFO Allocation
- Accounting Links
- Remaining Dollar Balance

This layer owns all financial calculations.

---

## Layer 4

Attribution Engine

Responsibilities

Connect marketing with orders.

Example

Facebook Click

↓

Customer Session

↓

Website Visit

↓

Checkout

↓

Order

↓

Products

↓

Campaign Attribution

This layer owns attribution algorithms.

---

## Layer 5

Analytics Engine

Responsibilities

Generate:

- Product Cost
- Campaign Profit
- Order Profit
- ROAS
- CAC
- CPP

using

Source Data

+

Attribution

+

Accounting

---

## Layer 6

Presentation Layer

Responsibilities

Provide:

- Dashboard
- Reports
- Drill Down
- Export
- Profit Explanation
- Audit Timeline

---

# Module Breakdown

The platform contains the following modules.

```

```text
Marketing Attribution

├── Facebook Integration

├── Marketing Accounting

├── Attribution Engine

├── Analytics Engine

├── Reporting Engine

├── Cost Allocation Engine

├── Event Processor

├── Snapshot Generator

├── Audit Engine

└── Notification Engine
```

---

# Facebook Integration Module

Responsibilities

- Connect Businesses
- Connect Ad Accounts
- Refresh Tokens
- Receive Webhooks
- Schedule Synchronization
- Sync Historical Data
- Sync Incremental Changes

Never performs:

- Accounting
- Profit Calculation
- Product Mapping

---

# Marketing Accounting Module

Responsibilities

Maintain complete advertising financial history.

Objects

- Payment
- Dollar Balance
- Exchange Rate
- Funding Source
- Voucher
- Journal Link
- Currency Ledger

This module becomes the accounting source of truth.

---

# Attribution Engine

Responsibilities

Determine which order belongs to which advertisement.

Priority

1.

Meta Click Identifier

↓

2.

Meta Pixel

↓

3.

Conversion API

↓

4.

Session Tracking

↓

5.

UTM Parameters

↓

6.

Manual Mapping

The engine should always use the highest confidence method available.

---

# Cost Allocation Engine

Responsibilities

Convert advertising spend into product costs.

The allocation always happens in two phases.

```

```text
Facebook Spend

↓

Attributed Orders

↓

Allocated Product Cost
```

Never

```text
Campaign

↓

Landing Page

↓

Product
```

Landing pages are not reliable indicators of purchased products.

---

# Profit Intelligence Engine

Responsibilities

Generate business metrics.

Examples

Revenue

↓

COGS

↓

Shipping

↓

Marketing Cost

↓

Payment Cost

↓

Net Profit

The engine should always be explainable.

---

# Reporting Engine

Provides

Campaign Reports

Ad Reports

Product Reports

Order Reports

Marketing Reports

Executive Dashboard

---

# Snapshot Engine

Purpose

Avoid expensive real-time calculations.

Responsibilities

Generate

Daily Summary

Campaign Summary

Product Summary

Marketing Summary

Order Summary

These snapshots are optimized for reading.

They can always be regenerated.

---

# Event Processing

The architecture follows Event Driven Design.

Example

Facebook Sync Finished

↓

Campaign Updated Event

↓

Analytics Dirty Event

↓

Queue Processing

↓

Snapshot Update

↓

Dashboard Refresh

Each module only reacts to events.

Modules never directly invoke business logic from other modules.

---

# Event Catalogue

Important Events

FacebookConnected

FacebookDisconnected

TokenRefreshed

CampaignCreated

CampaignUpdated

CampaignPaused

CampaignResumed

AdSetUpdated

AdUpdated

InsightsImported

SpendUpdated

DollarLedgerUpdated

PaymentRecorded

ExchangeRateUpdated

OrderCreated

OrderCancelled

OrderCompleted

OrderAttributed

AllocationCompleted

SnapshotGenerated

AnalyticsRecalculated

---

# Synchronization Strategy

Three synchronization modes are used.

## Initial Import

Executed once.

Imports:

- Historical Campaigns
- Historical Ads
- Historical Spend
- Historical Insights

Recommended default

90 Days

Runs in Background Queue.

---

## Incremental Sync

Runs every

15–30 minutes.

Imports only changed data.

Very lightweight.

---

## Daily Reconciliation

Runs every night.

Purpose

Ensure ERP and Facebook contain identical totals.

If mismatches exist

Generate reconciliation jobs.

Never modify accounting entries automatically.

---

# Synchronization Priority

Highest Priority

Campaign Status

Spend

Purchases

ROAS

---

Medium Priority

Ads

Ad Sets

Creatives

Budgets

---

Lowest Priority

Historical Metadata

Archived Objects

Deleted Campaigns

---

# Failure Recovery

Every synchronization job must be resumable.

Rules

- Retry automatically
- Exponential Backoff
- Dead Letter Queue
- Error Logging
- Partial Success Support

The system must never restart an entire synchronization because one campaign failed.

---

# Scalability Principles

The architecture must support:

- Multiple Companies
- Multiple Businesses
- Multiple Ad Accounts
- Millions of Orders
- Millions of Attribution Records
- Millions of Spend Records

without architectural redesign.

Every component should be horizontally scalable.

No calculation should require locking the entire database.

---

# Next Section

Part 3 will define:

- Complete Database Design
- Entity Relationships
- Prisma Models
- Raw Tables
- Snapshot Tables
- Ledger Tables
- Attribution Tables
- Indexing Strategy
- Partition Strategy
- Materialized Analytics Schema




# Database Architecture

## Database Design Philosophy

The Marketing Attribution Platform is expected to process millions of:

- Orders
- Order Items
- Attribution Events
- Facebook Insights
- Campaign Metrics
- Marketing Payments
- Cost Allocation Records

The database must therefore prioritize:

- Write Performance
- Read Performance
- Auditability
- Scalability
- Incremental Computation
- Historical Consistency

The system is intentionally designed around immutable source data and derived analytical data.

---

# Database Classification

Every table belongs to one of the following categories.

## 1. Configuration Tables

Contains user-defined settings.

Examples

- Connected Platforms
- Allocation Rules
- Attribution Settings
- Sync Configuration

These tables change very rarely.

---

## 2. Master Tables

Contains normalized business objects.

Examples

- Marketing Platform
- Business
- Ad Account
- Campaign
- Ad Set
- Ad

These are synchronized from external providers.

---

## 3. Event Tables

Contains historical events.

Examples

- Spend Imported
- Order Attributed
- Payment Recorded
- Campaign Updated

These tables should be append-only whenever possible.

---

## 4. Ledger Tables

Contains financial history.

Examples

- Dollar Ledger
- Marketing Payment
- Dollar Consumption
- Cost Allocation Ledger

Never update financial history.

Always append.

---

## 5. Snapshot Tables

Contains optimized reporting data.

Examples

- Daily Campaign Summary
- Daily Product Profit
- Daily Marketing Cost

Can be regenerated.

---

## 6. Raw Payload Tables

Stores original Facebook responses.

Purpose

- Audit
- Debugging
- Future Features

The system should never depend on these tables during normal operations.

---

# Multi-Tenant Strategy

Every business object must belong to a Company.

```

```text
Company

↓

Facebook Business

↓

Ad Account

↓

Campaign

↓

Ad Set

↓

Ad
```

No table should contain data shared across companies.

---

# Immutable Data Strategy

The following records should never be modified after creation.

- Payment Ledger
- Dollar Ledger
- Spend Import
- Attribution Event
- Accounting Link
- Conversion Event

Corrections should create adjustment records.

Never overwrite history.

---

# Mutable Data Strategy

The following records may change.

Campaign

Ad Set

Ad

Status

Budget

Name

Bid Strategy

These are synchronized from Facebook.

Only the latest version is stored in master tables.

Historical changes are stored separately.

---

# Soft Delete Strategy

Never physically delete

Campaign

Ad Set

Ad

Instead

```text
is_archived

archived_at

deleted_from_provider
```

This preserves historical reports.

---

# Timestamp Strategy

Every table must include

created_at

updated_at

For synchronized objects

synced_at

provider_updated_at

For analytics

calculated_at

For ledger

posted_at

---

# Universal IDs

Every synchronized entity should have

Internal UUID

+

Provider ID

Example

campaign_id

facebook_campaign_id

This allows future support for multiple platforms.

---

# Core Entity Relationship

```

```text
Company

│

├── Marketing Platform

│

├── Facebook Business

│

├── Ad Account

│

├── Campaign

│

├── Ad Set

│

├── Ad

│

├── Insight

│

├── Payment Ledger

│

├── Dollar Ledger

│

├── Attribution

│

├── Cost Allocation

│

└── Snapshot
```

---

# Master Tables

## marketing_platform

Represents external providers.

Examples

Facebook

Google Ads

TikTok

LinkedIn

Future Ready.

Columns

```text
id

name

slug

status

created_at
```

---

## marketing_connection

Represents OAuth connections.

Columns

```text
id

company_id

platform_id

provider_user_id

provider_business_id

access_token

refresh_token

token_expiry

status

last_sync_at

created_at
```

---

## ad_account

Columns

```text
id

company_id

connection_id

facebook_account_id

account_name

currency

timezone

status

is_active

last_sync_at
```

---

## campaign

Columns

```text
id

company_id

ad_account_id

facebook_campaign_id

campaign_name

objective

buying_type

status

effective_status

daily_budget

lifetime_budget

created_time

provider_updated_at

last_synced_at
```

---

## ad_set

Columns

```text
id

campaign_id

facebook_adset_id

name

status

optimization_goal

billing_event

bid_strategy

budget

start_time

end_time
```

---

## ad

Columns

```text
id

ad_set_id

facebook_ad_id

creative_id

creative_name

status

landing_url

preview_url

last_synced_at
```

---

# Insight Tables

Instead of updating one row repeatedly,

store periodic snapshots.

Example

campaign_insight

Columns

```text
campaign_id

date

hour

impressions

reach

clicks

cpc

cpm

ctr

spend

purchase

purchase_value

roas

frequency

synced_at
```

Composite Index

campaign_id

date

hour

---

Same strategy

adset_insight

ad_insight

---

# Payment Ledger

## marketing_payment

Represents real payments.

Columns

```text
id

company_id

platform

ad_account

payment_type

payment_date

payment_reference

accounting_voucher_id

bank_account_id

wallet_account_id

currency

currency_amount

base_currency

base_amount

effective_rate

remarks
```

No Spend Allocation here.

Only payment history.

---

# Dollar Ledger

Represents purchased advertising balance.

```

```text
Payment

↓

Dollar Ledger

↓

Remaining Balance

↓

Consumed Balance
```

Columns

```text
id

payment_id

ad_account_id

received_amount

remaining_amount

effective_rate

consumed_amount

status
```

---

# Dollar Consumption Ledger

Every consumption creates records.

Never overwrite.

Columns

```text
id

ledger_id

campaign_id

order_id

consumed_amount

effective_rate

calculated_cost

allocated_at
```

FIFO simply consumes

remaining_amount

---

# Attribution Tables

## marketing_session

Stores visit sessions.

Columns

```text
id

company_id

visitor_id

session_id

fbclid

utm_source

utm_medium

utm_campaign

utm_content

campaign_id

adset_id

ad_id

landing_url

started_at

ended_at
```

---

## order_attribution

Columns

```text
id

order_id

session_id

campaign_id

adset_id

ad_id

confidence_score

attribution_method

attributed_at
```

---

Confidence Score

Examples

100

Facebook Click ID

95

Conversion API

90

Meta Pixel

75

UTM

40

Manual

---

# Allocation Tables

## marketing_cost_allocation

One row per order.

Columns

```text
id

order_id

campaign_id

allocated_spend

allocated_currency

allocated_rate

allocated_cost

allocation_method

calculated_at
```

---

## product_marketing_cost

One row per product.

Columns

```text
id

order_item_id

allocation_id

marketing_cost

allocation_ratio

calculated_at
```

---

# Snapshot Tables

Purpose

Fast Reporting

Tables

campaign_daily_summary

product_daily_summary

marketing_daily_summary

order_profit_snapshot

company_marketing_summary

These tables can always be regenerated.

---

# Dirty Tracking Tables

Instead of recalculating everything.

Store

```text
entity_type

entity_id

reason

dirty_since

priority

status
```

Worker processes

only these rows.

---

# Audit Tables

Every calculation should be explainable.

Example

Order

↓

Marketing Cost

↓

Allocation

↓

Dollar Ledger

↓

Payment

↓

Accounting Voucher

Store

calculation_trace

as JSON.

Useful for

Explain Profit.

---

# Raw Payload Storage

Store every Facebook response.

```

```text
id

provider

endpoint

object_type

object_id

payload_json

received_at
```

Never query this table for reports.

Use only

Audit

Recovery

Future Migration

---

# Index Strategy

Indexes

Campaign ID

Ad Account ID

Order ID

Session ID

Company ID

Date

Provider ID

Composite

Company + Date

Campaign + Date

Product + Date

Order + Date

---

# Partition Strategy

Partition large tables by Month.

Examples

campaign_insight

ad_insight

marketing_session

raw_payload

Benefits

- Faster Queries
- Faster Cleanup
- Better Vacuum
- Lower Index Size

---

# JSON Usage Strategy

Use JSON only for

- Provider Payload
- Audit Trace
- Future Unknown Fields

Never store business-critical searchable data inside JSON.

Normalize first.

---

# Next Section

Part 4 will cover

- Facebook OAuth Flow
- Meta Graph API Integration
- Webhooks
- Token Lifecycle
- Incremental Synchronization
- Retry Strategy
- Rate Limiting
- Background Jobs
- Error Recovery
- Historical Import
- Nightly Reconciliation










# Facebook Integration Architecture

## Design Philosophy

The Facebook Integration Module is responsible only for communicating with Meta.

It should never contain business rules related to:

- Accounting
- Profit Calculation
- Product Mapping
- Marketing Cost Allocation
- ERP Reporting

Its only responsibility is:

Synchronize Facebook data into ERP.

---

# Integration Responsibilities

The Facebook Integration Module owns:

- OAuth Authentication
- Token Lifecycle
- Graph API Communication
- Webhook Processing
- Historical Import
- Incremental Synchronization
- Retry Management
- Provider Normalization
- Event Publishing

Nothing more.

---

# Supported Facebook Objects

The integration should synchronize the following objects.

## Business

Purpose

Discover available businesses connected to the authenticated user.

---

## Ad Accounts

Each connected business may contain multiple Ad Accounts.

Each Ad Account becomes an independent accounting unit.

Advertising money should never move automatically between Ad Accounts.

Each Ad Account owns:

- Campaigns
- Ad Sets
- Ads
- Spend
- Payment Ledger
- Dollar Ledger

---

## Campaigns

Synchronize

- Name
- Objective
- Buying Type
- Status
- Budget
- Effective Status
- Start Time
- Stop Time
- Updated Time

Campaigns created from Meta should automatically appear inside ERP.

No manual import should be required.

---

## Ad Sets

Synchronize

- Optimization Goal
- Billing Event
- Budget
- Bid Strategy
- Targeting
- Status

---

## Ads

Synchronize

- Ad Name
- Creative
- Preview
- Destination URL
- Status

---

## Insights

Synchronize

- Spend
- Impressions
- Reach
- Clicks
- CPC
- CPM
- CTR
- Purchases
- Purchase Value
- ROAS
- Frequency

Store insights as immutable snapshots.

Never overwrite historical insight rows.

---

# OAuth Flow

Authentication follows Meta OAuth.

Sequence

User

↓

Connect Facebook

↓

Meta Login

↓

Permission Approval

↓

Authorization Code

↓

Access Token

↓

Business Discovery

↓

Ad Account Discovery

↓

Store Connection

↓

Schedule Historical Import

---

Required Permissions

Examples

ads_management

ads_read

business_management

pages_read_engagement

(Additional permissions should be documented according to Meta Graph API requirements.)

The application should request only the minimum required permissions for MVP and expand later if additional capabilities require them.

---

# Token Lifecycle

Tokens should never be used directly by business services.

Instead

Facebook Adapter

↓

Token Manager

↓

Encrypted Storage

↓

API Client

↓

Facebook

Responsibilities

- Refresh Tokens
- Detect Expired Tokens
- Notify User
- Retry Failed Requests

---

# Encryption Strategy

Access Tokens

Refresh Tokens

Business IDs

should be encrypted at rest.

Application logs must never expose tokens.

---

# Historical Import

When an Ad Account is connected

the user chooses

- Last 30 Days
- Last 90 Days (Recommended)
- Last 180 Days
- Custom Range

The import immediately becomes a BullMQ Job.

The user may continue using ERP.

Progress should be visible.

Example

12%

25%

63%

Completed

---

# Incremental Synchronization

Runs automatically.

Recommended

Every 15–30 Minutes

Synchronize only changed data.

Priority

1.

Campaign Status

2.

Spend

3.

Purchases

4.

Budget

5.

Ads

6.

Metadata

---

# Nightly Reconciliation

Runs once daily.

Purpose

Ensure ERP matches Facebook.

Compare

Campaign Totals

Spend

Purchases

ROAS

Reach

Clicks

If differences exist

Generate reconciliation events.

Accounting records should never be modified automatically.

Only marketing data is reconciled.

---

# Synchronization Pipeline

```

```text
BullMQ Scheduler

↓

Sync Job

↓

Facebook Adapter

↓

Normalization

↓

Database

↓

Publish Events

↓

Analytics Dirty

↓

Queue Processing
```

---

# Adapter Pattern

The ERP should not know Facebook APIs.

Instead

```text
Marketing Provider

↓

Facebook Adapter

Google Adapter

TikTok Adapter

↓

Normalized Objects

↓

Marketing Platform
```

Every provider implements the same interface.

Example

```typescript
interface MarketingProvider {

connect()

disconnect()

refreshToken()

syncCampaigns()

syncAdSets()

syncAds()

syncInsights()

syncBusinesses()

syncAdAccounts()

registerWebhook()

}
```

Future providers simply implement this interface.

---

# Synchronization Strategy

Synchronization occurs in stages.

Stage 1

Businesses

↓

Stage 2

Ad Accounts

↓

Stage 3

Campaigns

↓

Stage 4

Ad Sets

↓

Stage 5

Ads

↓

Stage 6

Insights

Each stage publishes completion events.

---

# Data Normalization

Facebook objects should never be exposed directly to ERP.

Instead

Facebook Campaign

↓

Normalize

↓

Marketing Campaign

ERP consumes only normalized entities.

Provider-specific fields should remain inside Raw Payload storage.

---

# Webhook Architecture

Facebook Webhook

↓

Webhook Controller

↓

Validation

↓

Queue

↓

Worker

↓

Synchronization

↓

Publish Event

Webhooks should never perform heavy processing synchronously.

Always enqueue.

---

# Retry Strategy

Every API request supports:

Automatic Retry

Exponential Backoff

Dead Letter Queue

Failure Notification

Maximum retry count should be configurable.

---

# Rate Limiting

The integration must respect Meta API limits.

Implement

- Provider Rate Limiter
- Queue Throttling
- Batch Synchronization
- Adaptive Retry

If limits are reached

jobs should pause automatically.

---

# Batch Synchronization

Instead of

Campaign 1

Campaign 2

Campaign 3

Make provider-supported batch requests whenever possible.

Benefits

- Lower API Cost
- Lower Latency
- Better Throughput

---

# Error Classification

Errors should be categorized.

Authentication Error

↓

Reconnect Required

Permission Error

↓

Notify User

Rate Limit

↓

Retry Later

Temporary Error

↓

Retry

Permanent Error

↓

Manual Action Required

---

# Event Publishing

The Facebook module never calls Analytics directly.

Instead it publishes events.

Examples

FacebookConnected

FacebookDisconnected

CampaignImported

CampaignUpdated

CampaignPaused

AdCreated

AdUpdated

InsightImported

SpendUpdated

HistoricalImportCompleted

IncrementalSyncCompleted

NightlyReconciliationCompleted

---

# Event Consumers

Marketing Accounting

↓

Attribution Engine

↓

Analytics Engine

↓

Snapshot Generator

↓

Notification Service

Each service decides independently whether any action is required.

---

# Health Monitoring

Each integration maintains:

Connection Status

Token Expiry

Last Successful Sync

Current Queue Size

Failed Jobs

Webhook Health

API Latency

This information should be visible from an Integration Dashboard.

---

# Failure Recovery

The platform must support resumable synchronization.

If importing

500 Campaigns

and Campaign 347 fails

the next retry begins from Campaign 347.

Never restart from the beginning.

---

# Provider Versioning

Every Facebook Graph API version should be configurable.

Example

v23

↓

Configuration

↓

Facebook Adapter

No business logic should depend on a hardcoded API version.

---

# Security

Never trust incoming webhook payloads.

Validate:

- Signature
- Timestamp
- Source

Reject invalid requests immediately.

---

# Observability

Every synchronization should generate structured logs.

Track

- Job ID
- Company ID
- Ad Account ID
- Provider
- API Endpoint
- Duration
- Retry Count
- Records Imported
- Records Updated
- Errors

These logs become essential for debugging production issues.

---

# Next Section

Part 5 will define the core of the platform:

- Marketing Attribution Engine
- Session Tracking
- FBCLID Strategy
- Meta Pixel Integration
- Conversion API
- Attribution Algorithms
- Confidence Score
- Order Matching
- Product Mapping
- Explainable Attribution
- Allocation Decision Engine








# Marketing Attribution Engine

## Purpose

The Attribution Engine is responsible for connecting marketing activities with actual business outcomes.

It transforms disconnected marketing events into measurable financial intelligence.

The engine answers questions such as:

- Which campaign generated this order?
- Which ad generated this sale?
- Which products were sold because of this campaign?
- How much marketing cost belongs to this order?
- How much profit remained after marketing expenses?
- How confident is this attribution?

Unlike Meta Ads Manager, the Attribution Engine operates at the ERP level.

Its responsibility is not reporting advertising metrics.

Its responsibility is explaining business profitability.

---

# Design Philosophy

The engine follows four principles.

## Principle 1

Order is the source of commercial truth.

Facebook reports Purchases.

ERP knows actual Orders.

Whenever there is a conflict,

ERP Orders become the business truth.

---

## Principle 2

Marketing Cost belongs to Orders first.

Marketing Cost belongs to Products afterwards.

Never allocate directly

Campaign

↓

Product

Instead

Campaign

↓

Orders

↓

Products

This produces significantly more accurate profitability.

---

## Principle 3

Attribution should always be explainable.

Every attributed order must answer:

Why was this campaign selected?

Why was this advertisement selected?

Why was this confidence assigned?

Which evidence was used?

---

## Principle 4

The system should automate attribution whenever reliable evidence exists.

Manual intervention must always remain the last option.

---

# Attribution Pipeline

The complete customer journey.

Facebook Ad

↓

Customer Click

↓

Landing Page

↓

Website Session

↓

Browsing

↓

Product View

↓

Add To Cart

↓

Checkout

↓

Order Created

↓

Order Completed

↓

Marketing Attribution

↓

Marketing Cost Allocation

↓

Profit Calculation

↓

Business Intelligence

---

# Attribution Sources

The engine may receive attribution evidence from multiple sources.

Examples

Facebook Click Identifier (fbclid)

Meta Pixel

Meta Conversion API

UTM Parameters

Website Session

Referral URL

Landing Page

Internal Tracking Cookie

Future Mobile SDK

Each source contributes evidence.

No single source should be considered mandatory.

---

# Attribution Priority

When multiple sources exist,

the engine follows priority.

Priority 1

FBCLID

Priority 2

Meta Conversion API

Priority 3

Meta Pixel

Priority 4

Tracked Website Session

Priority 5

UTM Campaign

Priority 6

Manual Assignment

The highest confidence source wins.

---

# Attribution Confidence

Every attributed order receives a confidence score.

Example

100

Verified Click ID

95

Conversion API Match

90

Meta Pixel Match

80

Website Session Match

70

UTM Match

40

Manual Assignment

Confidence should always remain visible inside reports.

---

# Attribution Lifecycle

Visitor arrives.

↓

Session Created.

↓

Marketing Evidence Collected.

↓

Customer Browses Website.

↓

Customer Places Order.

↓

Order Completed.

↓

Background Attribution.

↓

Order Attribution Saved.

↓

Analytics Dirty Event.

↓

Snapshot Updated.

The checkout experience must never wait for attribution.

---

# Session Tracking

Every visitor receives

Visitor ID

Session ID

Session Start

Session End

Marketing Metadata

The session survives page navigation.

The session becomes part of the Order.

---

# Marketing Session

The session should remember

Landing URL

Referrer

UTM Source

UTM Medium

UTM Campaign

UTM Content

FBCLID

Campaign ID

Ad Set ID

Ad ID

Visit Timestamp

Device

Browser

Operating System

This information becomes immutable after session completion.

---

# Order Attribution

Every completed order stores

Campaign

Ad Set

Ad

Attribution Method

Confidence

Attributed Time

Attribution Version

Explanation

Explanation should be human readable.

Example

Matched using FBCLID.

Campaign verified through Meta Conversion API.

Confidence: 100%.

---

# Attribution Window

The attribution engine supports configurable windows.

Recommended

7 Days Click

Future

1 Day

7 Day

28 Day

Custom

This configuration remains company specific.

---

# Multi Touch Attribution

MVP

Last Click Attribution

Future

First Click

Linear

Time Decay

Position Based

Data Driven

The architecture should not prevent future algorithms.

---

# Product Mapping Philosophy

Products should never be mapped directly from advertisements.

Instead

Advertisement

↓

Orders

↓

Purchased Products

The purchased products become the actual allocation targets.

This reflects real customer behaviour.

---

# Order Cost Allocation

The first allocation stage.

Example

Campaign Spend

↓

Attributed Orders

↓

Order Marketing Cost

Formula

Campaign Spend

/

Attributed Orders

=

Average Order Marketing Cost

Alternative algorithms may be introduced later.

---

# Product Cost Allocation

Second stage.

Order Marketing Cost

↓

Allocation Rule

↓

Products

Supported Rules

Equal Distribution

Product Value Ratio

Quantity Ratio

Future Custom Rules

The selected rule is configurable per company.

---

# Smart Allocation

If an advertisement promotes multiple products,

the engine should not assume the landing page product was purchased.

Instead

Determine

Actual Purchased Products

↓

Allocate Cost

This avoids incorrect profitability.

---

# Explainable Allocation

Every allocated marketing cost should expose

Campaign

Ad

Spend

Dollar Ledger

Exchange Rate

Allocation Rule

Confidence

Calculation Timestamp

Users should always understand

Why this product received this marketing cost.

---

# Attribution State Machine

Every order passes through states.

UNATTRIBUTED

↓

PENDING

↓

ATTRIBUTED

↓

ALLOCATED

↓

PROFIT_UPDATED

↓

SNAPSHOTTED

Failed orders

↓

RETRY

↓

MANUAL REVIEW

---

# Dirty Tracking

The engine never recalculates all orders.

Instead

Campaign Spend Changed

↓

Affected Orders Identified

↓

Dirty Records Created

↓

BullMQ Job

↓

Incremental Allocation

↓

Snapshot Refresh

Only affected records are recalculated.

---

# Dependency Graph

Every object knows its dependencies.

Campaign

↓

Orders

↓

Order Items

↓

Products

↓

Snapshots

If Campaign changes,

only dependent objects become dirty.

---

# Recalculation Strategy

Never

Recalculate Entire Company

Instead

Recalculate

Affected Campaign

↓

Affected Orders

↓

Affected Products

↓

Affected Snapshots

This guarantees scalability.

---

# Profit Explanation

Every Order exposes

Revenue

↓

COGS

↓

Shipping

↓

Marketing Cost

↓

Exchange Rate

↓

Accounting Voucher

↓

Net Profit

Each value should be clickable.

The ERP should explain every calculation.

---

# Attribution Event Log

Every important attribution event should be recorded.

Examples

Session Started

Session Updated

Session Completed

Order Attributed

Confidence Changed

Allocation Started

Allocation Completed

Profit Recalculated

Snapshot Generated

These events support replay and debugging.

---

# Future Ready Architecture

The Attribution Engine should not know

Facebook

Google

TikTok

directly.

Instead

Marketing Source

↓

Normalized Campaign

↓

Normalized Session

↓

Normalized Attribution

↓

ERP Analytics

New marketing providers should plug into the same attribution engine.

---

# AI Assisted Attribution (Future)

Future versions may introduce

AI Confidence Validation

Duplicate Detection

Anomaly Detection

Suspicious Attribution Detection

Cross Campaign Analysis

Attribution Recommendations

These features should consume attribution events rather than replacing core algorithms.

---

# Next Section

Part 6 will cover

- Marketing Accounting Engine
- Advertising Dollar Ledger
- FIFO Cost Engine
- Exchange Rate Handling
- Accounting Voucher Integration
- Payment Workflow
- Spend Consumption
- Multi Ad Account Ledger
- Financial Audit Trail
- Explainable Currency Cost









# Marketing Accounting Engine

## Purpose

The Marketing Accounting Engine bridges the gap between advertising platforms and ERP Accounting.

Advertising platforms understand:

- Spend
- Campaigns
- Clicks
- Purchases

Accounting understands:

- Bank Accounts
- Cash
- Wallets
- Journal Entries
- Exchange Rates

This module connects these two worlds.

It provides an auditable financial foundation for every marketing expense.

---

# Design Philosophy

The accounting engine follows four principles.

## Principle 1

ERP is the Financial Source of Truth.

Facebook never determines accounting values.

ERP Accounting always determines financial values.

---

## Principle 2

Funding is recorded before spending.

Money must enter the Marketing Funding Ledger before it can be consumed.

Example

Bank Payment

↓

Marketing Funding

↓

Advertising Spend

↓

Cost Allocation

---

## Principle 3

Historical financial records are immutable.

Financial records are never overwritten.

Corrections are always adjustment entries.

---

## Principle 4

Every advertising expense must be traceable.

Users should always know

Which payment funded this spend?

Which bank account was used?

Which exchange rate was applied?

Which accounting voucher recorded it?

---

# Financial Workflow

Advertising funding follows this lifecycle.

Funding Source

↓

Accounting Payment

↓

Marketing Funding Ledger

↓

Available Balance

↓

Advertising Spend

↓

Funding Consumption

↓

Marketing Cost

↓

Profit Calculation

---

# Marketing Funding Ledger

The Funding Ledger represents available advertising funds.

It is platform-independent.

Examples

Facebook USD

Google BDT

TikTok USD

LinkedIn EUR

Every funding record belongs to:

- Company
- Marketing Platform
- Ad Account
- Currency
- Accounting Voucher

---

# Funding Sources

Supported funding sources.

- Bank Account
- Debit Card
- Credit Card
- Wallet
- Cash
- Virtual Card
- Future Payment Gateway

The funding source is always selected by the user.

---

# Accounting Integration

Every funding transaction should be linked to ERP Accounting.

Relationship

Funding Entry

↓

Accounting Voucher

↓

Journal Entries

↓

Ledger Accounts

Marketing Accounting never creates independent financial records.

It always references ERP Accounting.

---

# Marketing Funding Entry

Each funding transaction stores:

Funding Date

Platform

Ad Account

Funding Currency

Funding Amount

Base Currency

Base Amount

Effective Exchange Rate

Accounting Voucher

Funding Source

Reference Number

Remarks

Status

Created By

Posted At

---

# Exchange Rate Strategy

The platform never guesses exchange rates.

The user confirms:

Funding Amount

↓

Received Advertising Currency

↓

Effective Exchange Rate

Example

Paid

26,300 BDT

Received

200 USD

Effective Rate

131.50

This rate becomes immutable.

---

# Funding Consumption

Advertising spend never consumes money directly from payments.

Instead

Payment

↓

Funding Ledger

↓

Remaining Balance

↓

Consumption Ledger

This allows accurate financial tracking.

---

# Consumption Strategy

MVP

FIFO

Future

Weighted Average

Specific Identification

LIFO (Optional)

FIFO remains the recommended accounting strategy.

---

# FIFO Consumption Example

Funding Ledger

Entry A

100 USD

Rate

128

Remaining

100

Entry B

50 USD

Rate

130

Remaining

50

Campaign Spend

120 USD

Consumption

100 USD

from Entry A

20 USD

from Entry B

The resulting marketing cost reflects actual funding history.

---

# Consumption Ledger

Every spend generates immutable consumption records.

Each record stores

Funding Entry

Consumed Amount

Campaign

Order

Exchange Rate

Calculated Cost

Timestamp

No consumption record is ever edited.

---

# Partial Consumption

Funding entries may be partially consumed.

Example

Funding

200 USD

Consumed

35 USD

Remaining

165 USD

The remaining balance stays available.

---

# Multiple Ad Accounts

Each Ad Account owns an independent funding ledger.

Funding must never move automatically between Ad Accounts.

If users intentionally transfer balances,

ERP records explicit transfer transactions.

---

# Multi Currency Design

The accounting engine supports multiple currencies.

Business Logic never depends on USD.

Currency becomes a property.

Future examples

USD

EUR

BDT

AED

GBP

The allocation engine remains unchanged.

---

# Financial Reconciliation

The system periodically validates

Funding Balance

↓

Consumed Amount

↓

Remaining Balance

↓

Facebook Spend

Any mismatch generates reconciliation alerts.

No automatic accounting correction is performed.

---

# Funding State Machine

Every funding entry progresses through states.

Draft

↓

Confirmed

↓

Posted

↓

Partially Consumed

↓

Fully Consumed

↓

Archived

Accounting postings determine state transitions.

---

# Manual Adjustments

If corrections are required,

create

Adjustment Entry

rather than modifying historical funding.

The audit trail must remain complete.

---

# Cost Calculation

Marketing Cost

=

Consumed Funding

×

Effective Exchange Rate

The calculation always uses historical funding rates.

Never today's exchange rate.

---

# Explainable Currency Cost

Every calculated marketing cost should expose:

Funding Entry

↓

Accounting Voucher

↓

Funding Source

↓

Exchange Rate

↓

Consumption Record

↓

Campaign

↓

Order

↓

Product

Users can trace every currency conversion.

---

# Accounting Audit Trail

Every financial action records:

Who performed it?

When?

Why?

Which voucher?

Which funding source?

Which exchange rate?

Which campaign?

Which ad account?

The audit trail must satisfy financial review requirements.

---

# Platform Independence

The accounting engine never references Facebook directly.

Instead

Marketing Platform

↓

Funding Ledger

↓

Consumption Engine

↓

Cost Allocation

↓

Profit

New advertising platforms reuse the same accounting engine.

---

# Financial Events

The module publishes events.

FundingRecorded

FundingConfirmed

FundingPosted

FundingConsumed

FundingAdjusted

FundingTransferred

ExchangeRateRecorded

ReconciliationStarted

ReconciliationCompleted

AccountingLinked

These events are consumed by the Attribution and Analytics modules.

---

# Error Handling

The accounting engine validates:

Negative Funding

Negative Remaining Balance

Over Consumption

Currency Mismatch

Duplicate Funding

Voucher Mismatch

Invalid Exchange Rate

Invalid Accounting Reference

Invalid records are rejected before posting.

---

# Performance Considerations

Funding records are append-only.

Consumption records are append-only.

Indexes should exist on:

Company

Platform

Ad Account

Funding Date

Remaining Balance

Status

Voucher ID

These indexes support high-volume allocation.

---

# Security

Only authorized accounting users may:

Create Funding

Confirm Funding

Adjust Funding

Link Accounting Vouchers

Marketing users may view funding summaries but should not modify financial records.

(Authorization integrates with the ERP's existing RBAC framework.)

---

# Future Extensions

Planned capabilities include:

Automatic Bank Feed Import

Card Statement Import

Virtual Card Integration

Expense Approval Workflow

Scheduled Funding

Budget Forecasting

Funding Recommendations

Currency Hedging Analysis

Multi-Currency Treasury Dashboard

---

# Next Section

Part 7 will define:

- Event-Driven Architecture
- BullMQ Job Design
- Redis Strategy
- Dirty Tracking
- Incremental Recalculation
- Snapshot Engine
- Queue Prioritization
- Retry Policies
- Job Idempotency
- Background Processing Pipeline








# Event-Driven Architecture

## Philosophy

The Marketing Attribution Platform must be fully event-driven.

Business modules should never call each other directly.

Instead, every module publishes domain events.

Other modules independently decide whether they need to react.

This architecture provides:

- Loose Coupling
- Horizontal Scalability
- Fault Isolation
- Better Retry Strategy
- Easier Testing
- Future Extensibility

---

# High Level Event Flow

```text
               Facebook Integration
                        │
                        ▼
                Domain Event Bus
                        │
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
Funding Engine   Attribution Engine   Analytics Engine
        │               │                │
        └───────────────┼────────────────┘
                        ▼
                  Snapshot Engine
                        │
                        ▼
                 Dashboard / Reports
```

---

# Domain Events

Every important business action generates a domain event.

Examples

FacebookConnected

FacebookDisconnected

CampaignImported

CampaignUpdated

CampaignPaused

CampaignResumed

InsightImported

SpendImported

FundingRecorded

FundingConfirmed

FundingConsumed

OrderCreated

OrderCompleted

OrderCancelled

OrderAttributed

AllocationCompleted

SnapshotGenerated

AnalyticsUpdated

---

# Event Rules

Events are immutable.

Events are append-only.

Events contain business facts.

Events never contain business logic.

Example

GOOD

CampaignPaused

BAD

PauseCampaign()

Events describe what happened.

Never what should happen.

---

# Event Envelope

Every event should include

Event ID

Event Type

Company ID

Platform

Entity ID

Occurred At

Correlation ID

Causation ID

Payload Version

Payload

This supports replay, debugging and distributed tracing.

---

# BullMQ Architecture

BullMQ becomes the orchestration backbone.

Recommended queues

facebook-sync

facebook-webhook

historical-import

incremental-sync

funding-processing

attribution

allocation

analytics

snapshot

notification

reconciliation

Each queue owns one responsibility.

---

# Queue Responsibility

facebook-sync

Synchronize campaigns

Synchronize ads

Synchronize insights

---

historical-import

Import historical data

Chunk processing

Resume support

Progress tracking

---

funding-processing

Funding validation

Voucher linking

Ledger creation

FIFO preparation

---

attribution

Session matching

FBCLID matching

UTM matching

Confidence calculation

Order attribution

---

allocation

Marketing cost allocation

Funding consumption

Order cost allocation

Product allocation

---

analytics

Generate summaries

Profit calculation

ROAS

CAC

CPP

---

snapshot

Materialize reporting tables

Generate dashboards

Update summaries

---

notification

Notify users

Sync failures

Expired tokens

Completed imports

---

reconciliation

Nightly reconciliation

Mismatch detection

Consistency verification

---

# Job Design Principles

Every job must be

Small

Independent

Retryable

Idempotent

Interruptible

Observable

Never build long-running monolithic jobs.

---

# Job Chaining

Example

Facebook Sync

↓

Campaign Updated

↓

Mark Dirty

↓

Allocation Job

↓

Analytics Job

↓

Snapshot Job

↓

Dashboard Updated

Each stage becomes a separate BullMQ job.

---

# Job Idempotency

Every job must safely execute multiple times.

Example

Import Campaign

If campaign already exists

↓

Update

↓

Publish only changed events

Never create duplicates.

---

# Dirty Tracking

The platform never recalculates everything.

Instead

Campaign Updated

↓

Create Dirty Record

↓

Worker Finds Dirty Records

↓

Process

↓

Clear Dirty Flag

Dirty objects become the workload.

---

# Dependency Graph

Campaign

↓

Orders

↓

Order Items

↓

Products

↓

Snapshots

Only downstream objects are recalculated.

---

# Incremental Recalculation

The recalculation engine determines

Changed Entity

↓

Affected Orders

↓

Affected Products

↓

Affected Reports

Everything else remains untouched.

---

# Recalculation Threshold

Tiny changes should not trigger expensive work.

Example

Spend changed

0.20%

↓

Skip

Spend changed

5%

↓

Recalculate

Thresholds should be configurable.

---

# Snapshot Strategy

Snapshots are read-optimized.

Examples

Campaign Daily Summary

Product Daily Profit

Marketing Dashboard

Order Profit Snapshot

Snapshots are disposable.

Raw data is permanent.

---

# Snapshot Refresh Policy

Incremental Refresh

Default strategy.

Nightly Full Refresh

Safety strategy.

Manual Refresh

Administrative operation.

---

# Redis Responsibilities

Redis should NOT store business data.

Redis stores

Queue State

Distributed Locks

Job Progress

Temporary Cache

Rate Limits

Session Cache

Nothing permanent.

---

# Distributed Locking

Only one worker may process

Historical Import

for the same Ad Account.

Redis lock

AdAccount

↓

Acquire

↓

Process

↓

Release

Avoid duplicate imports.

---

# Retry Policy

Transient Errors

↓

Retry

Authentication Errors

↓

Notify User

↓

Stop Queue

Validation Errors

↓

Dead Letter Queue

↓

Manual Review

---

# Exponential Backoff

Suggested delays

1 min

2 min

5 min

15 min

30 min

1 hour

Configurable.

---

# Dead Letter Queue

Every queue owns a DLQ.

Purpose

Manual inspection

Debugging

Replay

Nothing should disappear silently.

---

# Worker Concurrency

Recommended

facebook-sync

Low

historical-import

Low

allocation

High

analytics

High

snapshot

Medium

notification

High

Concurrency should be configurable.

---

# Chunk Processing

Never import

100,000 records

in one job.

Instead

1000

↓

1000

↓

1000

↓

1000

Chunk size should be configurable.

---

# Event Ordering

Ordering matters.

Campaign Imported

must happen before

Insight Imported.

Funding Recorded

must happen before

Funding Consumption.

Workers must validate prerequisites.

---

# Job Cancellation

Users may cancel

Historical Imports

Long Reports

Manual Rebuilds

Jobs should stop gracefully.

---

# Observability

Every queue exposes

Pending Jobs

Running Jobs

Completed Jobs

Failed Jobs

Average Duration

Retry Count

Success Rate

These metrics should appear in an internal monitoring dashboard.

---

# Structured Logging

Every job logs

Job ID

Queue

Company

Platform

Entity

Duration

Retries

Worker

Status

Correlation ID

Never log secrets.

---

# Metrics

Recommended metrics

Jobs/sec

Import latency

API latency

Average allocation time

Average attribution time

Queue depth

Worker utilization

Snapshot generation time

---

# Event Replay

Events should be replayable.

Example

Bug Fixed

↓

Replay Attribution Events

↓

Regenerate Profit

↓

Refresh Snapshots

Without touching source data.

---

# Failure Isolation

One failed campaign

must never stop

the remaining campaigns.

One failed order

must never stop

analytics generation.

Isolation is mandatory.

---

# Scalability Goals

The architecture should comfortably support

Millions of Orders

Millions of Sessions

Millions of Insights

Millions of Allocation Records

Millions of Snapshot Rows

without redesign.

Horizontal scaling should require adding workers only.

---

# Production Deployment

Recommended services

API Server

Worker Cluster

Scheduler

Redis

PostgreSQL

Monitoring

Each service should scale independently.

---

# Next Section

Part 8 will define

- NestJS API Contracts
- REST Endpoints
- Webhook Controllers
- Admin UI
- React SPA Screens
- Dashboard UX
- Storefront Tracking
- Next.js Middleware
- Meta Pixel Integration
- Conversion API
- User Workflow





# Part 8 - API Contracts, Admin UI & User Experience

---

# API Design Philosophy

The Marketing Attribution Platform exposes business-oriented APIs.

APIs should never expose Facebook Graph API directly.

Clients communicate only with ERP APIs.

Example

React SPA

↓

ERP API

↓

Marketing Service

↓

Facebook Adapter

↓

Meta Graph API

This abstraction allows future provider changes without affecting frontend applications.

---

# API Versioning

All APIs must be versioned.

Example

/api/v1/marketing

Future

/api/v2/marketing

Versioning should remain independent of Meta Graph API versions.

---

# REST API Modules

The Marketing module exposes the following logical API groups.

Authentication

Facebook Connections

Businesses

Ad Accounts

Campaigns

Ad Sets

Ads

Insights

Marketing Funding

Marketing Attribution

Profit Analysis

Reports

Analytics

Settings

Health

---

# Facebook Connection APIs

## Connect Facebook

POST

/api/v1/marketing/facebook/connect

Purpose

Start OAuth flow.

Response

Authorization URL

---

## OAuth Callback

GET

/api/v1/marketing/facebook/callback

Purpose

Complete OAuth.

Stores encrypted credentials.

Schedules historical import.

---

## Disconnect

DELETE

/api/v1/marketing/facebook/{connectionId}

Purpose

Disconnect provider.

Historical data remains.

Future synchronization stops.

---

## Connection Status

GET

/api/v1/marketing/facebook/status

Returns

Connected

Disconnected

Token Expiry

Last Sync

Webhook Status

---

# Business APIs

GET

/api/v1/marketing/businesses

Returns

Available Businesses

Connected Businesses

Business Metadata

---

# Ad Account APIs

GET

/api/v1/marketing/ad-accounts

Supports

Search

Pagination

Filtering

Sorting

---

GET

/api/v1/marketing/ad-accounts/{id}

Returns

Account Details

Currency

Timezone

Spend Summary

Funding Summary

Campaign Count

Health Status

---

POST

/api/v1/marketing/ad-accounts/{id}/sync

Starts immediate synchronization.

Background job.

---

# Campaign APIs

GET

/api/v1/marketing/campaigns

Supports

Company

Business

Ad Account

Status

Objective

Date Range

Search

Sorting

Pagination

---

GET

/api/v1/marketing/campaigns/{id}

Returns

Campaign

Insights

Spend

Orders

Profit

Products

Timeline

Audit

---

POST

/api/v1/marketing/campaigns/{id}/pause

Pauses campaign.

Background execution.

---

POST

/api/v1/marketing/campaigns/{id}/resume

Resumes campaign.

---

POST

/api/v1/marketing/campaigns/{id}/refresh

Forces synchronization.

---

# Ad Set APIs

GET

/api/v1/marketing/adsets

GET

/api/v1/marketing/adsets/{id}

Returns

Performance

Spend

Orders

Products

---

# Ad APIs

GET

/api/v1/marketing/ads

GET

/api/v1/marketing/ads/{id}

Returns

Creative

Preview

Landing URL

Orders

Marketing Cost

ROAS

---

# Marketing Funding APIs

POST

/api/v1/marketing/funding

Create funding entry.

Body

Platform

Ad Account

Funding Source

Currency

Funding Amount

Exchange Rate

Voucher

Reference

Remarks

---

GET

/api/v1/marketing/funding

Returns

Funding History

Remaining Balance

Consumed Balance

Accounting Links

---

GET

/api/v1/marketing/funding/{id}

Returns

Complete funding trace.

---

POST

/api/v1/marketing/funding/{id}/confirm

Posts funding.

---

# Attribution APIs

GET

/api/v1/marketing/attribution/orders

Returns

Attributed Orders

Confidence

Campaign

Ad

Marketing Cost

---

GET

/api/v1/marketing/attribution/orders/{id}

Returns

Complete attribution explanation.

---

POST

/api/v1/marketing/attribution/recalculate

Creates background recalculation job.

---

# Profit APIs

GET

/api/v1/marketing/profit/orders

Order profitability.

---

GET

/api/v1/marketing/profit/products

Product profitability.

---

GET

/api/v1/marketing/profit/campaigns

Campaign profitability.

---

GET

/api/v1/marketing/profit/dashboard

Executive dashboard.

---

GET

/api/v1/marketing/profit/orders/{id}/explain

Returns

Revenue

COGS

Shipping

Marketing Cost

Exchange Rate

Funding Ledger

Voucher

Allocation

Final Profit

---

# Reporting APIs

Campaign Summary

Product Summary

Marketing Summary

Daily Summary

Monthly Summary

ROAS

CPA

CAC

Marketing Expense

Top Products

Top Campaigns

Top Ads

---

# Webhook Controller

POST

/api/v1/webhooks/facebook

Responsibilities

Validate Signature

Verify Payload

Create Queue Job

Return Immediately

Never perform business logic.

---

# Internal Event APIs

Internal only.

Never public.

Examples

CampaignUpdated

SpendImported

FundingRecorded

AllocationCompleted

SnapshotGenerated

---

# API Response Format

Every response follows the same structure.

Success

status

data

meta

Error

status

error

code

message

details

timestamp

requestId

---

# Pagination

Cursor pagination preferred.

Supports

limit

cursor

sort

order

---

# Filtering

All reporting endpoints support

Date

Campaign

Ad Account

Business

Product

Category

Brand

Status

Marketing Platform

---

# Admin UI

Navigation

Marketing

├── Dashboard

├── Facebook

├── Ad Accounts

├── Campaigns

├── Ad Sets

├── Ads

├── Funding

├── Attribution

├── Profit Analysis

├── Reports

├── Settings

---

# Dashboard

Widgets

Today's Spend

Today's Orders

Marketing Cost

Revenue

Profit

ROAS

CAC

CPA

Top Campaign

Top Product

Top Ad

Sync Status

Funding Balance

---

# Campaign Screen

Columns

Campaign

Status

Spend

Revenue

Profit

Orders

ROAS

CTR

Purchases

Confidence

Actions

Pause

Resume

Refresh

Explain

---

# Campaign Details

Tabs

Overview

Insights

Orders

Products

Funding

Audit

Timeline

Profit

Settings

---

# Product Profit Screen

Columns

Product

Revenue

COGS

Marketing Cost

Shipping

Profit

Margin

ROAS

Orders

---

# Order Profit Screen

Columns

Order

Customer

Revenue

COGS

Marketing Cost

Shipping

Net Profit

Confidence

Explain

---

# Explain Profit Modal

Displays complete calculation.

Revenue

↓

Discount

↓

COGS

↓

Shipping

↓

Marketing Cost

↓

Funding Entry

↓

Exchange Rate

↓

Voucher

↓

Net Profit

Every value should be clickable.

---

# Funding Screen

Displays

Funding Entries

Remaining Balance

Consumed Balance

Exchange Rate

Accounting Voucher

Status

---

# Attribution Screen

Displays

Sessions

Campaign

Ad

Confidence

Method

Matched Orders

Unmatched Orders

Manual Review

---

# Reports

Campaign Reports

Ad Reports

Funding Reports

Profit Reports

Marketing Reports

Order Reports

Export

CSV

Excel

PDF

---

# Settings

Allocation Rules

Attribution Window

Synchronization Frequency

Notification Settings

Default Currency

Thresholds

---

# User Experience Guidelines

Keep UI simple.

Avoid technical language.

Provide

Tooltips

Examples

Recommendations

Warnings

Setup Wizards

Explain buttons

Confidence indicators

Users should understand the system without reading documentation.

---

# Storefront Integration

The Next.js storefront automatically captures

FBCLID

UTM

Session

Visitor

Landing Page

Referrer

Device

Browser

These values are attached to the order during checkout.

No manual intervention required.

---

# Conversion API

Every completed order should trigger

Meta Conversion API

in background.

Failures should retry automatically.

Customer checkout must never wait for Meta.

---

# Monitoring Dashboard

System administrators can view

Queue Health

Sync Health

Token Status

API Latency

Webhook Health

Failed Jobs

Average Processing Time

Dirty Records

Snapshot Freshness

---

# Next Section

Part 9 will complete the specification with

Implementation Roadmap

Milestones

Testing Strategy

Deployment

Production Monitoring

Security Checklist

Performance Benchmarks

Architecture Decision Records (ADR)

Future Extensions







# Part 9 - Implementation Roadmap, Testing, Deployment & Architecture Decision Records

---

# Implementation Philosophy

This project should never be developed feature-by-feature.

Instead it should be developed foundation-first.

Recommended order

Infrastructure

↓

Database

↓

Integration

↓

Events

↓

Attribution

↓

Accounting

↓

Analytics

↓

Frontend

↓

Optimization

---

# Phase 1

Project Foundation

Estimated

1 Sprint

Deliverables

- Marketing Module
- Folder Structure
- Prisma Modules
- Event Bus
- BullMQ Setup
- Redis Configuration
- Environment Variables
- Feature Flags
- Logging
- Monitoring

No UI yet.

---

# Phase 2

Database Layer

Estimated

2 Sprints

Deliverables

Master Tables

Ledger Tables

Snapshot Tables

Raw Tables

Indexes

Partitions

Migrations

Seed Data

Acceptance

Database supports

multiple companies

multiple ad accounts

future providers

---

# Phase 3

Facebook Integration

Estimated

2 Sprints

Deliverables

OAuth

Connection Management

Business Discovery

Ad Account Discovery

Campaign Sync

Ad Set Sync

Ad Sync

Historical Import

Incremental Sync

Webhook

Nightly Reconciliation

Acceptance

User connects Facebook.

Campaigns appear automatically.

---

# Phase 4

Marketing Funding Engine

Estimated

1 Sprint

Deliverables

Funding Ledger

Funding Entries

Voucher Integration

Exchange Rate

FIFO Engine

Funding Balance

Consumption Ledger

Acceptance

Users can record advertising funding.

---

# Phase 5

Session Tracking

Estimated

1 Sprint

Deliverables

Visitor Tracking

FBCLID

UTM

Session Tracking

Cookie Strategy

Checkout Integration

Order Metadata

Acceptance

Orders contain marketing metadata.

---

# Phase 6

Attribution Engine

Estimated

2 Sprints

Deliverables

Order Attribution

Confidence Engine

Session Matching

Manual Review

Attribution Events

Acceptance

Orders automatically connect to campaigns.

---

# Phase 7

Cost Allocation Engine

Estimated

2 Sprints

Deliverables

Order Allocation

Product Allocation

Allocation Rules

Explain Cost

Dirty Tracking

Acceptance

Marketing Cost appears on products.

---

# Phase 8

Analytics Engine

Estimated

2 Sprints

Deliverables

Campaign Profit

Order Profit

Product Profit

ROAS

CAC

CPA

Daily Summary

Acceptance

Profit dashboards available.

---

# Phase 9

Snapshot Engine

Estimated

1 Sprint

Deliverables

Snapshot Tables

Incremental Refresh

Nightly Refresh

Materialized Reports

Acceptance

Large reports open within seconds.

---

# Phase 10

React Admin

Estimated

2 Sprints

Deliverables

Dashboard

Campaign Screen

Funding Screen

Reports

Profit

Explain Profit

Settings

Responsive UI

Acceptance

Marketing users can manage everything.

---

# Phase 11

Optimization

Estimated

1 Sprint

Deliverables

Caching

Redis Optimization

Query Optimization

Queue Optimization

Batch Processing

Load Testing

Acceptance

Large datasets remain responsive.

---

# Phase 12

Production Readiness

Estimated

1 Sprint

Deliverables

Backup Strategy

Monitoring

Alerts

Health Checks

Disaster Recovery

Security Review

Documentation

Acceptance

Production Deployment Approved.

---

# Development Order

Backend

↓

Database

↓

Queues

↓

Integration

↓

Attribution

↓

Accounting

↓

Analytics

↓

Frontend

↓

Optimization

Never reverse this order.

---

# NestJS Module Structure

marketing

facebook

providers

funding

ledger

attribution

allocation

analytics

snapshot

reports

settings

webhook

shared

Each module owns

Controller

Service

Repository

Events

Jobs

DTOs

Validators

---

# Queue Development Order

1

Facebook Sync

2

Historical Import

3

Funding

4

Attribution

5

Allocation

6

Analytics

7

Snapshot

8

Notification

9

Reconciliation

---

# Prisma Migration Order

Platform

↓

Connections

↓

Businesses

↓

Accounts

↓

Campaigns

↓

Ad Sets

↓

Ads

↓

Insights

↓

Funding

↓

Ledger

↓

Sessions

↓

Attribution

↓

Allocation

↓

Snapshots

Never migrate snapshots first.

---

# Frontend Development Order

Facebook Connection

↓

Ad Accounts

↓

Campaign List

↓

Campaign Details

↓

Funding

↓

Reports

↓

Profit

↓

Settings

---

# Testing Strategy

## Unit Tests

Funding Engine

FIFO

Allocation

Attribution

Exchange Rate

Validation

---

## Integration Tests

Facebook OAuth

Webhook

Campaign Sync

Funding

Queue

Accounting

---

## End-to-End Tests

Connect Facebook

↓

Sync Campaign

↓

Receive Order

↓

Attribute Order

↓

Allocate Spend

↓

Calculate Profit

↓

Dashboard Updated

---

# Performance Tests

Test with

100 Companies

1000 Ad Accounts

100,000 Campaigns

10 Million Orders

100 Million Sessions

Measure

API

Queues

Memory

CPU

Database

---

# Failure Tests

Expired Token

Facebook Down

Redis Restart

Worker Crash

Database Restart

Webhook Replay

Duplicate Jobs

Network Failure

System must recover automatically.

---

# Monitoring

Metrics

API Response Time

Queue Depth

Worker Health

Sync Latency

Snapshot Freshness

Database Size

Funding Balance

Failed Attribution

Failed Jobs

---

# Security Checklist

Encrypt Tokens

Encrypt Secrets

Validate Webhooks

Rate Limiting

Audit Logs

Permission Checks

Input Validation

Secure Cookies

HTTPS Only

CSRF Protection

XSS Protection

SQL Injection Prevention

---

# Deployment

Recommended

API Cluster

↓

Worker Cluster

↓

Scheduler

↓

Redis

↓

PostgreSQL

↓

Monitoring

↓

Object Storage

All independently scalable.

---

# Architecture Decision Records

## ADR-001

Event Driven Architecture

Decision

Use asynchronous domain events.

Reason

Loose coupling.

Future integrations.

---

## ADR-002

Immutable Ledger

Decision

Never update financial history.

Reason

Accounting integrity.

---

## ADR-003

Order First Allocation

Decision

Allocate spend

Campaign

↓

Orders

↓

Products

Reason

Reflects actual customer purchases.

---

## ADR-004

Platform Agnostic Design

Decision

Business logic never references Facebook directly.

Reason

Future Google Ads

TikTok

LinkedIn

Support.

---

## ADR-005

Incremental Recalculation

Decision

Never recalculate the entire database.

Reason

Scalability.

---

## ADR-006

Snapshot Tables

Decision

Maintain read-optimized reporting.

Reason

Fast dashboards.

---

## ADR-007

Marketing Funding Ledger

Decision

Funding is platform-independent.

Reason

Supports multiple currencies and advertising providers.

---

## ADR-008

Explainable Profit

Decision

Every calculated number must expose its origin.

Reason

Trust

Auditability

Financial transparency

---

# Success Criteria

The project is considered successful when

A business owner can answer

Which campaigns make money?

Which campaigns lose money?

Which products are profitable after marketing cost?

Which orders generated actual profit?

Which funding entry paid for this campaign?

Which exchange rate was applied?

Why did this product receive this marketing cost?

without leaving the ERP.

---

# Future Roadmap

Google Ads

TikTok Ads

LinkedIn Ads

Pinterest Ads

WooCommerce

Shopify

Marketplace Attribution

Offline Conversion Import

AI Budget Recommendation

AI Campaign Optimization

Marketing Forecasting

Marketing Anomaly Detection

Predictive ROAS

Customer Lifetime Value Attribution

Cross Channel Attribution

---

# Conclusion

This specification intentionally separates

Marketing

Accounting

Analytics

Reporting

Integration

into independent domains.

The architecture is designed to support enterprise-scale workloads while remaining extensible for future advertising platforms and sales channels.

The resulting system is not a Facebook integration.

It is a complete Marketing Attribution Platform capable of becoming the marketing intelligence layer of the ERP.