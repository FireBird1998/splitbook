# SplitBook launch pricing and Vercel break-even

**Date:** 2026-10-10

**Scope:** Android and website first; ₹19/month or ₹199/year; MongoDB; no OCR or image storage initially. Forecasting assumptions, not an observed invoice or tax determination.

This research records the earlier ₹19 monthly proposal. The [launch and pricing plan](../launch-and-pricing-plan.md) supersedes it with ₹29/month or ₹199/year and a ₹5,000 monthly infrastructure budget.

## Decision

Staying on Vercel is economically possible. At a **$60 total monthly bill including tax**, using illustrative ₹90/USD, roughly **453 annual subscribers** cover ₹5,400/month; **536** generate ₹1,000/month operating surplus. A practical target is **550 retained subscribers**, budgeting as though all choose annual billing. This also provides about 20% cost headroom under the base assumptions below.

If $60 is **before** infrastructure tax, the comparable practical target rises to approximately **650 annual subscribers**. If $60 is Vercel alone, add MongoDB and other costs before calculating the target. Do not migrate hosting solely because of an assumed $60 minimum: Vercel's published Pro entry price is $20.

## Verified provider facts

- **Vercel Pro:** $20/month, with $20 included usage credit. Usage and optional features can add costs. Published prices exclude applicable taxes, calculated from billing details. Hobby is for personal, non-commercial use. A $60 monthly bill is a scenario, not the Pro starting price. [Vercel pricing](https://vercel.com/pricing)
- **MongoDB Atlas Flex:** $8–$30 for 30 days, billed hourly; base includes 5 GB storage, 100 operations/second and unlimited data transfer. This is suitable for low-traffic production according to MongoDB. The price cap does not remove storage/throughput limits; a later tier upgrade may be necessary. [Atlas Flex costs and limits](https://www.mongodb.com/docs/atlas/billing/atlas-flex-costs/)
- **Google Play India:** automatically renewing subscriptions currently incur a 15% service fee under the remaining-markets schedule. Other countries/programs can differ. [Play service fees](https://support.google.com/googleplay/android-developer/answer/112622)
- **India developer tax correction:** Google says an India-located developer must determine GST registration/applicable taxes and pay applicable taxes on Google service fees. Google may deduct withholding tax and GST TCS. Its statement about remitting purchase GST on the developer's behalf applies to developers **outside India** selling to Indian customers. Earlier blanket claims that Google handles all Indian GST are therefore unsuitable here. [Google tax guidance, India sections](https://support.google.com/googleplay/android-developer/answer/138000)

## Assumptions and formulas

- ₹90/USD is an **illustration**, not a verified current exchange rate. Actual conversion and bank fees change costs.
- Base forecast assumes advertised subscription prices include 18% sales GST and Play charges 15% on the tax-exclusive sale. Tax applicability, registration, invoice treatment and credits must be confirmed for this business; 18% is a scenario assumption here.
- Monthly net contribution: `19 / 1.18 × 0.85 = ₹13.68644068`.
- Annual net contribution: `199 / 1.18 × 0.85 = ₹143.34745763/year`, or **₹11.94562147/month**. This corrects the earlier conversational estimate of approximately ₹14/month.
- Equal customer mix: `(13.68644068 + 11.94562147) / 2 = ₹12.81603107/customer/month`.
- Break-even: `ceil(monthly operating cost / monthly contribution)`.
- ₹1,000 operating surplus: `ceil((monthly operating cost + 1000) / monthly contribution)`.
- Annual cash arrives upfront but funds twelve months. Maintain a reserve; new annual sales alone do not establish sustainable recurring revenue.

These are subscriber-equivalent recurring economics, not guaranteed cash payouts. Ads are assumed **₹0**. Refunds, failed renewals, acquisition costs, development time, income tax, domain, email and other costs are excluded unless already inside the stated total bill. Withholding/TCS can affect cash timing and are not automatically permanent expenses. Input tax credits may reduce effective cost.

No actual Vercel/Atlas invoice, account usage or Google Play settlement was accessed. These are budget scenarios, not a forecast of SplitBook's measured bill.

## Exact subscriber thresholds

All customer counts round upward from unrounded contributions. The 50/50 column is a modeled equal mix by subscriber count; odd totals approximate that mix.

| Monthly cost scenario                             |  INR cost | Break-even: monthly plan | Break-even: annual plan | Break-even: 50/50 mix | ₹1,000 surplus: monthly | ₹1,000 surplus: annual | ₹1,000 surplus: 50/50 |
| ------------------------------------------------- | --------: | -----------------------: | ----------------------: | --------------------: | ----------------------: | ---------------------: | --------------------: |
| $60 total, taxes already included                 |    ₹5,400 |                      395 |                     453 |                   422 |                     468 |                    536 |                   500 |
| $60 before assumed 18% infrastructure tax         |    ₹6,372 |                      466 |                     534 |                   498 |                     539 |                    618 |                   576 |
| $60 Vercel + $8 Atlas, both with assumed 18% tax  | ₹7,221.60 |                      528 |                     605 |                   564 |                     601 |                    689 |                   642 |
| $60 Vercel + $30 Atlas, both with assumed 18% tax |    ₹9,558 |                      699 |                     801 |                   746 |                     772 |                    884 |                   824 |

Infrastructure tax in these scenarios is illustrative, not a verified assertion that each invoice will charge 18% or that the tax is unrecoverable.

### Conservative annual-plan targets

Twenty percent headroom means revenue covers **120% of modeled costs**, not a 20% profit margin on revenue.

| Monthly cost | Annual subscribers for 20% headroom | Rounded launch milestone |
| ------------ | ----------------------------------: | -----------------------: |
| ₹5,400       |                                 543 |                      550 |
| ₹6,372       |                                 641 |                      650 |
| ₹7,221.60    |                                 726 |                      750 |
| ₹9,558       |                                 961 |                    1,000 |

### Sensitivity: unrecovered GST on Play's service fee

If an additional 18% GST applies to the 15% service fee and is not recovered through input credit, model contribution as `retail / 1.18 × (1 − 0.15 × 1.18)`. This gives **₹13.25169492/month** for monthly subscriptions and **₹11.56617232/month equivalent** for annual subscriptions.

| Monthly cost | Break-even: monthly | Break-even: annual | Break-even: 50/50 mix |
| ------------ | ------------------: | -----------------: | --------------------: |
| ₹5,400       |                 408 |                467 |                   436 |
| ₹6,372       |                 481 |                551 |                   514 |
| ₹7,221.60    |                 545 |                625 |                   582 |
| ₹9,558       |                 722 |                827 |                   771 |

This sensitivity is not a determination of legal liability. Actual Play settlement reports and the business's tax treatment should replace it before financial commitments.

Under this conservative service-fee-tax sensitivity, **600 retained annual subscribers** produce about ₹6,939.70/month equivalent, covering the ₹6,372 scenario with ₹567.70 headroom. **700** produce ₹8,096.32, or approximately ₹1,724.32 surplus before excluded costs. Both milestones assume $60 includes MongoDB before the modeled infrastructure tax. If $60 is Vercel alone plus $30 Atlas, the conservative annual break-even is **827**, so 600 is insufficient.

## Launch interpretation

### Multiple products on one Vercel Pro team

Vercel lists unlimited projects for Pro. Two or three separate products can be separate projects within one Pro team; the $20 platform fee includes one deploying developer seat and $20 monthly usage credit, rather than charging $20 for each website. Additional deploying seats are $20/month each. The team's credit and metered-usage budget are shared, so more projects do not multiply included credit. End-user/customer accounts are not deploying seats. [Vercel project limits](https://vercel.com/docs/limits), [Pro billing](https://vercel.com/docs/plans/pro-plan), [Team spend management](https://vercel.com/docs/spend-management)

A hypothetical $60 Vercel-only, pre-tax bill for one developer could consist of the $20 base plus $40 of metered usage beyond included resources/credit. It is not a fixed-price three-website package or a guarantee of sufficient capacity. Databases, domains, optional add-ons, taxes and currency fees must be budgeted separately where applicable. Spend-management thresholds cover excess metered usage, not base seats/add-ons/integrations; alerts alone do not stop usage, and automatic pausing makes production websites/APIs unavailable and can be delayed by several minutes. [Spend-management scope and behavior](https://vercel.com/docs/spend-management)

₹199/year is ₹16.58/month at retail, a **12.72% discount** against twelve ₹19 payments. It is a coherent launch pairing; this research verifies economics, not competitor conversion or willingness to pay.

For a ₹5,400 all-in bill, 453 paying annual subscribers means about 9,060 active users at illustrative 5% paid conversion, or 22,650 at 2%. These are examples, not forecasts. Free customers also create hosting/database load: subscriber counts cannot guarantee that the bill stays at $60.

Keep the Vercel deployment during the APK testing period. On commercial launch, use Pro, avoid optional paid add-ons, record actual monthly invoices and net subscription settlements, and decide about VPS migration from measured costs and maintenance capacity. Define a finite personal subsidy runway rather than expecting immediate profitability. This report changes no application code or existing plan files.
