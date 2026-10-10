# SplitBook launch and pricing plan

Updated: 11 October 2026. Status: agreed business direction; implementation and launch checks remain.

Launch Android and the website first, charge **₹29/month or ₹199/year** for one personal subscription across both clients, and keep total monthly infrastructure spending within **₹5,000**. Stay on Vercel and use MongoDB. The initial launch excludes iOS, OCR and image storage. The founder will fund the initial period while testing whether retained subscriptions can cover operating costs.

## Pricing and free access

| Plan         | Price     | Access                                                                                                             |
| ------------ | --------- | ------------------------------------------------------------------------------------------------------------------ |
| Free         | ₹0        | Create or join **three groups combined**, with basic expense tracking, balances and settlements; light advertising |
| Plus monthly | ₹29/month | More groups, no ads and premium tools                                                                              |
| Plus annual  | ₹199/year | The same benefits as monthly Plus, billed annually                                                                 |

The limit is per user, not per group creator: creating two groups and joining one uses all three free slots. A fourth creation or join requires Plus, even when the inviter pays. Whether archived groups free a slot remains an open decision; do not silently turn the limit into three groups over the user's lifetime.

₹199/year is equivalent to ₹16.58/month and discounts twelve ₹29 payments by approximately **43%**. Expect annual billing to be attractive, and budget conservatively as though most subscribers choose it. These are launch prices to validate, not a permanent price commitment. Review pricing after two or three billing cycles; subscriber growth alone does not require a price increase.

### Proposed premium packaging

- Additional groups and removal of advertising.
- Advanced web spending dashboards, group insights and exports.
- Recurring household expenses once enabled and verified for launch.
- MCP access when its implementation is ready; it is not a launch dependency.

The paid group limit and exact feature entitlements still need implementation decisions. Do not advertise features that are not available. On subscription expiry, preserve existing records and access to balances and settlements; decide how users select the three groups available for continued expense entry.

## Launch scope and sequence

1. **Continue the Android APK beta with friends.** Validate invitation acceptance, expense creation and editing, custom splits, multiple payers, balance accuracy, settlements, Android/web consistency and recovery after connection failures.
2. **Prepare monetisation.** Implement the shared account entitlement, combined group limit, subscription purchase verification, restoration, renewals, cancellation and expiry handling. Start with Google Play billing on Android and recognise that entitlement on the website. Website checkout is a separate decision.
3. **Launch Android and the website publicly.** Complete Play Store requirements, production authentication and account deletion, privacy disclosures, support contact, database recovery checks, and the free/paid experience before accepting payments.
4. **Review after two or three billing cycles.** Use actual invoices and subscription settlements to assess cost coverage, retention and pricing. Expand features or infrastructure only when the results justify it.

Later work: iOS, OCR and receipt image handling. Price and meter OCR after measuring its costs; do not promise unlimited future OCR within this subscription.

## Hosting and monthly budget

Use the existing Vercel web deployment as the website and Android backend. MongoDB Atlas remains the database target. Begin with Vercel Pro and consider Atlas Flex for a paid database suitable for low traffic.

Vercel Pro starts at **$20/month**, including one deploying developer seat and $20 monthly usage credit. Multiple projects can share one Pro team and its credit; additional products do not each require another base subscription. Usage, extra deploying seats and optional add-ons can increase the bill. [Vercel Pro pricing](https://vercel.com/docs/plans/pro-plan)

Atlas Flex costs **$8–$30 for 30 days**, billed hourly according to usage. Its base includes 5 GB storage; growth beyond the tier's limits may require a different database plan. [MongoDB Flex pricing](https://www.mongodb.com/docs/atlas/billing/atlas-flex-costs/)

| Planning scenario                                  | Vercel | MongoDB | Estimated monthly cost |
| -------------------------------------------------- | -----: | ------: | ---------------------: |
| Light usage                                        |    $20 |      $8 |                 ₹2,974 |
| Flex at its upper price, with Vercel still at base |    $20 |     $30 |                 ₹5,310 |

These estimates use an **illustrative ₹90/USD exchange rate** and **18% infrastructure tax allowance**. They exclude domain renewal, card/currency charges, other services and Vercel overages. Actual tax treatment and exchange rates may differ. The higher scenario already exceeds the ₹5,000 ceiling: this budget requires active cost management, not just selecting these plans.

Target approximately **₹3,000/month initially**, leaving room for domain allocation, incidental charges and reserve within the ₹5,000 ceiling. Review spending weekly, with suggested alerts at ₹3,500 and ₹4,500. Avoid optional paid add-ons and review usage before increasing capacity. Configure Vercel's excess-usage controls with room for its base fee, MongoDB, taxes and other charges. Automatic pausing makes production websites and APIs unavailable, and its checks can lag; alerts alone do not stop spending. [Vercel spend management](https://vercel.com/docs/spend-management)

Keep Vercel for the launch. Revisit VPS hosting only if measured savings justify owning deployment, server maintenance, database backups and outage response.

## Revenue and break even

Base forecast assumptions: Indian retail subscription prices include 18% sales GST; Google Play charges 15% on the tax-exclusive subscription sale; ad revenue is ₹0. These are planning assumptions, not a determination of this business's tax liabilities. [Play service fees](https://support.google.com/googleplay/android-developer/answer/112622)

| Plan      |                                  Estimated net contribution |
| --------- | ----------------------------------------------------------: |
| ₹29/month |                             ₹20.89 per subscriber per month |
| ₹199/year | ₹143.35 per subscriber per year, or ₹11.95/month equivalent |

Monthly contribution is `29 / 1.18 × 0.85`. Annual monthly equivalent is `199 / 1.18 × 0.85 / 12`. Break even is monthly operating cost divided by the contribution, rounded up using unrounded values.

| Monthly operating bill       | All monthly subscribers | All annual subscribers | Approximately half on each |
| ---------------------------- | ----------------------: | ---------------------: | -------------------------: |
| ₹2,974 light-usage estimate  |                     143 |                    249 |                        182 |
| ₹5,000 budget ceiling        |                     240 |                    419 |                        305 |
| ₹5,310 higher-usage estimate |                     255 |                    445 |                        324 |

At **300 retained annual subscribers**, estimated revenue is ₹3,584/month equivalent; at **500**, it is ₹5,973. Use 300 as the first cost-coverage milestone and 500 as the next milestone, conditional on actual costs. These are contribution estimates, not guaranteed profit: additional service-fee taxes, refunds, failed renewals, other expenses, development time and income tax are not included. Free users also generate infrastructure usage, so subscriber counts cannot guarantee a fixed bill.

For an India-located developer, Google specifies responsibilities for applicable GST and taxes on its service fees, and may deduct withholding tax and GST TCS. Do not assume Google remits all purchase GST on this business's behalf. Credits and withholding can affect cash timing and effective cost; replace the forecast with actual settlement data before treating it as profit. [Google India tax guidance](https://support.google.com/googleplay/android-developer/answer/138000)

Annual payments arrive upfront but fund twelve months of service. Maintain a reserve instead of treating the full payment as that month's profit. The earlier [launch economics research](research/launch-pricing-vercel-economics.md) retains the ₹19 monthly alternatives and detailed tax sensitivities; **₹29/month and ₹199/year in this plan supersede those earlier price proposals**.

## Advertising and positioning

Show modest advertising on free accounts, away from expense saving and settlement confirmation. Plus removes ads. Suggested message: “Ads help keep SplitBook running. Get Plus to remove ads and unlock more groups.” Do not ask users to click ads to support the app.

Budget advertising revenue as zero until measured. Track actual earnings alongside any effects on retention and usability. Final ad placement, provider and privacy requirements remain to be selected.

Position SplitBook as affordable group expense tracking across Android and web. It has substantial core overlap with Splitwise, but does not have full Pro parity. Search, charts and exports are implemented on web; native reporting/search/export coverage is narrower. Recurring household expenses are implemented but disabled by default. Automatic currency conversion, OCR and transaction import are outside the initial offering. [Splitwise feature reference](https://www.splitwise.com/), [Splitwise Pro reference](https://www.splitwise.com/pro)

Splitwise's current Android subscription price in India remains unverified. Do not publish an exact savings percentage against it until the in-app Android offer is checked.

## Decisions and metrics for the next review

- Decide whether archived groups count toward the three-group limit, how reactivation works, and whether blocking a fourth invitation harms adoption.
- Finalise Plus group capacity, feature entitlements, expiry behaviour and website purchase availability.
- Set a finite personal funding runway; the monthly ceiling is agreed, but the number of funded months is not.
- Record active users, successful invitations, users hitting the group limit, paid conversion, renewals, churn, refunds, plan mix, net subscription revenue and actual infrastructure spending.
- Compare retained revenue with the total bill. Reduce unnecessary usage first; revisit pricing or hosting based on evidence rather than automatically as registrations increase.
- Recheck provider prices, store policies and tax assumptions before commercial launch. The pricing evidence above was checked during the 10–11 October 2026 planning discussion.
