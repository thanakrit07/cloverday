# Cloversky — Product Spec

This document captures the purpose and requirements of the app, distilled from the original conversation. It is the starting point for the design and implementation in this repo (`thanakrit07/cloversky`).

## 1. Purpose

A shared personal-finance app for **a couple (2 people)**, built to:

1. **Show where the money goes** — track income and expenses, attributable to each person.
2. **Show how much cash to set aside each billing cycle** — especially for the many concurrent installment plans and credit-card balances.
3. **Support debt planning** — know which debt to pay down first to save the most interest.
4. *(Later goal, not yet designed)* Investment planning and retirement planning.

The project originates from a Google Sheet the user has maintained for a long time. The sheet already has a detailed data structure (see §5), but it is painful to use on a phone and does not separate the two people's income and expenses. The new app must fix those two problems and add planning capabilities the sheet cannot provide.

## 2. Users

* Two people, on separate devices. Mobile is the primary surface; web/desktop is secondary.
* No appetite for a complex login system. The current prototype uses shared storage with no auth at all (anyone with the link sees everything), which is **not acceptable for production** — real auth must be designed in (see §7).

## 3. Pain points observed in the real sheet data

These observations from the source sheet motivate the feature set:

* Multiple credit cards / installment accounts (KTC, CardX, CardX SpeedyCash, UOB Premier, UOB Cash Plus, Spaylater) with a combined limit of roughly ฿680,000.
* In several months (Feb, Apr, May, Jun 2026) credit-card outflow is higher than or close to total income, because many installment plans run concurrently.
* Three cash-advance balances carry interest as high as 9.99%, far more expensive than the regular installment plans (0–0.74%). These should be paid down first.
* "Money left to spend" drops very low in some months (~฿3,600), showing tight liquidity.
* The sheet does not separate the two people's income and expenses, so the income figures do not reflect reality.

## 4. Features (from the current prototype — used as the baseline)

> **Superseded in places by DESIGN v3 (2026-07-31).** After real phase-1 use, the user chose the **Money Manager** app as the UX reference for data entry. The deltas against this baseline: transaction entry becomes a field-form with a fixed picker panel and an in-app calculator keypad, with recurring/installment creation inline (DESIGN D9); categories become two-level main/sub (D10); card-billed installment periods post their transactions automatically and each card gains a per-billing-cycle statement view, replacing the manual "paid this period" button of §4.3 (D11).

### 4.1 Dashboard

* Income / expense / balance summary for the selected month, split by person (person 1 / person 2 / shared).
* Monthly installment burden (total of periods not yet paid).
* Six-month income-vs-expense trend chart.
* Expense-by-category summary for the selected month (bar list).

### 4.2 Transactions

* Create / edit / delete income and expense records.
* Fields: date, kind (income/expense), category, description, amount, owner (person 1 / person 2 / shared), account or card.
* Filter by month and by person.

### 4.3 Installments

* Track installment plans: name, category, start date, total periods, amount per period, periods already paid, linked account/card, interest rate / note, owner.
* Per-period progress bar plus a one-tap "paid this period" button.
* Automatic warning for high-interest plans (≥5%).

### 4.4 Accounts — two sections

* Accounts / cash: name, type (bank / cash / e-wallet), owner, current balance.
* Credit cards: card name, credit limit, current-cycle spend (excluding installment periods), statement day, due day, annual interest rate, owner.
* The system computes used / remaining credit per card, automatically including the outstanding installment balance linked to that card.
* Transaction (4.2) and installment (4.3) forms pick accounts/cards from a dropdown sourced from this tab.

### 4.5 Plan — three sub-sections

* **Forward installment calendar**: the installment amount due over the next 12 months, derived from active plans (start date + periods paid), broken down per account/card per month, with high-total months highlighted.
* **Category budgets**: a monthly cap per category compared against actual spend for the selected month (green / amber / red by ratio).
* **Debt payoff plan (avalanche)**: rank all outstanding installment debt by highest interest rate first and recommend paying the most expensive one down first.

### 4.6 Settings

* Set both people's display names (used everywhere instead of "person 1 / person 2").
* Record counts by type.
* Import / re-import data from the source Google Sheet.

## 5. Reference data structure from the source Google Sheet

The source sheet has 8 tabs: `Dashboard`, `Transactions`, `Installment`, `Credit Card`, `Per-account monthly summary`, `Accounts`, `Categories`, and one personal tab.

Key fields used:

* **Transactions**: transaction date, entry date, kind (income/expense), category, description, income amount, expense amount, running balance, account, note.
* **Installment**: name, category, start date, total periods, amount per period, periods paid, outstanding balance, paying account, status, note (holds the interest rate, e.g. "installment 0.74%", "installment 9.99%").
* **Credit Card**: card name, credit limit, statement day, due day, annual interest rate, current-cycle spend, amount paid, amount outstanding, remaining credit, status.
* **Per-account monthly summary**: two summary tables — (1) income/expense per account per month, and (2) per credit card per billing cycle. The second is the single most valuable output of the sheet ("what is due on each card in each billing cycle") and must remain a first-class feature of the new app (matching §4.5).

Expense categories in real use: installments, insurance, food, transport, shopping, phone/internet, entertainment, health, education, housing, travel, other.

Income categories: salary, side income, bonus, other.

## 6. Current prototype

Built as a React artifact for in-chat testing:

* The data model is a single JSON blob (`people`, `transactions`, `installments`, `cards`, `accounts`, `budgets`) in Claude Artifact persistent storage (`window.storage`, shared mode).
* Real data has been imported from the Google Sheet as the seed set (600+ transactions, 25 installment plans, 6 cards).
* Key limitations: no real authentication (anyone with the link sees everything), no offline use (requires the Claude link), no app icon / PWA.

## 7. Decisions to make when rebuilding in Claude Code

* **Authentication**: per-person login (email/password or magic link) instead of an unauthenticated shared link.
* **Database**: a real backend (e.g. Supabase/Postgres) instead of artifact key-value storage.
* **Offline / PWA**: installable on mobile with partial offline data.
* **Hosting**: where to deploy (e.g. Vercel) plus an optional custom domain.
* **Real-time sync between the two people**: live updates when both have the app open, or periodic refresh.
* **Recurring transactions**: recurring income and expenses (salary, insurance premiums, phone bills, subscriptions) should not be re-entered by hand every month — see DESIGN §4.4 and §6.6.
* **Not yet designed**: investment planning and retirement planning (§1 item 4) — to be specified when that phase is reached.

## 8. Repo

`https://github.com/thanakrit07/cloversky`
