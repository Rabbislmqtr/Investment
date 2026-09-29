/**
 * The printed statement of account — the document "Save as PDF" puts on paper, and the
 * document "Preview sheet" shows at true paper size.
 *
 * It renders through a portal onto `document.body` so the print stylesheet can hide the whole
 * application with a single `#root { display: none }` — chasing every wrapper between here and
 * the root would be fragile, and portalling keeps the statement out of the app's dark theme
 * regardless of how that theme evolves.
 *
 * Everything the statement draws comes from `ReportModel`, which is built by
 * `lib/reportModel.ts` and unit-tested there. This file is presentation only: three sheets —
 * member accounts, a payment calendar, and the ledger detail — laid out as A4 paper. Its
 * styles live next to it in `statement.css`.
 */
import { createPortal } from "react-dom";
import { formatBdt, formatBdtAmount, formatDate } from "../lib/format";
import { REPORT_ALL } from "../lib/reportModel";
import type { ReportModel } from "../lib/reportModel";
import "./statement.css";

export function ReportStatement({ model, preview, onClosePreview }: {
  model: ReportModel;
  preview: boolean;
  onClosePreview: () => void;
}) {
  const { masthead, fund, roster, calendar, ledger, reconciliation } = model;
  const generatedLabel = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" }).format(
    masthead.generatedAt,
  );

  const figures = [
    { label: "Approved contributions", value: fund.approvedBdt, hinge: false },
    { label: "Refunds paid", value: fund.refundsPaidBdt, hinge: false },
    { label: "Refunds reserved", value: fund.refundsReservedBdt, hinge: false },
    { label: "Available fund", value: fund.availableBdt, hinge: true },
  ];

  const notPaidInFull = roster.rows.length - roster.totals.paidCount;

  return createPortal(
    <article
      className={preview ? "report-doc is-preview" : "report-doc"}
      aria-label={`Statement of account for ${masthead.projectName}`}
    >
      {preview && (
        <div className="report-preview-bar">
          <p className="report-preview-note">
            Print preview at true paper size, A4. Scroll sideways for the full sheet.
          </p>
          <button className="report-preview-close" type="button" onClick={onClosePreview}>
            Close preview
          </button>
        </div>
      )}
      <section className="report-sheet">
        <header className="report-masthead">
          <p className="report-masthead__wordmark">Home Investment</p>
          <h1 className="report-masthead__title">Statement of account</h1>
          <p className="report-masthead__scope">
            {masthead.projectName} {"\u00b7"} {masthead.memberFilterLabel} {"\u00b7"} {masthead.monthFilterLabel}{" \u00b7 "}
            accounts to {masthead.asOfLabel} {"\u00b7"} generated {generatedLabel}
          </p>
          <p className="report-masthead__lede">
            Approved member contributions of {formatBdt(fund.approvedBdt)} are recorded to {masthead.asOfLabel}.{" "}
            {formatBdt(fund.refundsPaidBdt)} has been refunded to members who left and{" "}
            {formatBdt(fund.refundsReservedBdt)} is reserved against settlements in progress, leaving{" "}
            {formatBdt(fund.availableBdt)} available in the fund.
          </p>
        </header>

        <section className="report-block">
          <div className="report-sheet__head">
            <h2 className="report-sheet__title">Fund position</h2>
            <p className="report-sheet__scope">Every period, every member. The filters in the ledger below never change this.</p>
          </div>
          <div className="report-figures">
            {figures.map((figure) => (
              <div className={figure.hinge ? "report-figure report-figure--hinge" : "report-figure"} key={figure.label}>
                <p className="report-figure__label">{figure.label}</p>
                <p className="report-figure__value">{formatBdt(figure.value)}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="report-block">
          <div className="report-sheet__head">
            <h2 className="report-sheet__title">Member accounts</h2>
            <p className="report-sheet__scope">
              Each member owes {formatBdt(roster.monthlyContributionBdt)} a month from {masthead.periodStartLabel}.
              {" "}
              {roster.rows.length === 0
                ? "No active members are in scope."
                : notPaidInFull === 0
                  ? `All ${roster.rows.length} members have paid through ${masthead.asOfLabel}.`
                  : `${notPaidInFull} of ${roster.rows.length} members have not paid in full; largest shortfall first.`}
            </p>
          </div>
          <table className="report-table report-table--accounts">
            <caption>
              Member accounts, cumulative to {masthead.asOfLabel}
              {masthead.monthFilterKey ? `, with the selected month shown separately` : ""}. Amounts in BDT.
            </caption>
            <colgroup>
              <col className="report-col--index" />
              <col className="report-col--member" />
              <col className="report-col--figure" />
              <col className="report-col--figure" />
              {masthead.monthFilterKey && <col className="report-col--period" />}
              <col className="report-col--figure" />
              <col className="report-col--month" />
              <col className="report-col--date" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Member</th>
                <th scope="col" className="num">Required to date</th>
                <th scope="col" className="num">Paid to date</th>
                {masthead.monthFilterKey && (
                  <th scope="col" className="num">Paid in {masthead.monthFilterLabel}</th>
                )}
                <th scope="col" className="num">Balance</th>
                <th scope="col">Paid through</th>
                <th scope="col">Last paid</th>
              </tr>
            </thead>
            <tbody>
              {roster.rows.map((row, index) => (
                <tr key={row.memberId}>
                  <td className="report-index">{index + 1}</td>
                  <td>
                    <div className="report-member">
                      <span className="report-member__name">{row.memberName}</span>
                      <span className="report-member__meta">
                        {row.memberCode ? `${row.memberCode} \u00b7 ` : ""}
                        {Math.round(row.coveragePercent)}% covered
                      </span>
                      <span className="report-coverage">
                        <span className="report-coverage__track">
                          <span
                            className={row.paid ? "report-coverage__fill" : "report-coverage__fill is-overdue"}
                            style={{ width: `${Math.max(0, Math.min(100, row.coveragePercent))}%` }}
                          />
                        </span>
                      </span>
                    </div>
                  </td>
                  <td className="num">{formatBdt(row.requiredToDateBdt)}</td>
                  <td className="num">{formatBdt(row.paidToDateBdt)}</td>
                  {masthead.monthFilterKey && (
                    <td className="num">{(row.paidInScopeMonthBdt ?? 0) > 0 ? formatBdt(row.paidInScopeMonthBdt ?? 0) : "\u2014"}</td>
                  )}
                  <td className="num">
                    <ReportBalance row={row} />
                  </td>
                  <td>{row.paidThroughLabel ?? "No full month"}</td>
                  <td>{row.lastPaymentDate ? formatDate(row.lastPaymentDate) : "None"}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>{`Total \u00b7 ${roster.rows.length} members`}</th>
                <td className="num">{formatBdt(roster.totals.requiredToDateBdt)}</td>
                <td className="num">{formatBdt(roster.totals.paidToDateBdt)}</td>
                {masthead.monthFilterKey && (
                  <td className="num">
                    {roster.totals.paidInScopeMonthBdt > 0 ? formatBdt(roster.totals.paidInScopeMonthBdt) : "\u2014"}
                  </td>
                )}
                <td className="num">{formatBdt(roster.totals.remainingDueBdt)}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
          <p className="report-note">{buildReconciliationNote(model)}</p>
        </section>
      </section>

      <section className="report-sheet">
        <div className="report-sheet__head">
          <h2 className="report-sheet__title">Payment calendar</h2>
          <p className="report-sheet__scope">
            Who paid in which month, {masthead.periodStartLabel} to {masthead.asOfLabel}. Blank cells mean nothing
            was approved for that member that month.
          </p>
        </div>
        {calendar.blocks.length === 0 ? (
          <p className="report-note">No months are in scope for this statement.</p>
        ) : (
          calendar.blocks.map((block) => (
            <div className="report-calendar-block" key={block.months[0]?.key ?? "block"}>
              <table className="report-table report-table--calendar">
                <caption>
                  {block.months[0]?.label} to {block.months[block.months.length - 1]?.label}. Amounts in BDT.
                </caption>
                <colgroup>
                  <col className="report-col--calendar-member" />
                  {block.months.map((month) => (
                    <col key={month.key} />
                  ))}
                  <col className="report-col--calendar-count" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">Member</th>
                    {block.months.map((month) => (
                      <th scope="col" className={month.isScopeMonth ? "is-scope" : undefined} key={month.key}>
                        {month.shortLabel}
                      </th>
                    ))}
                    <th scope="col">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {block.rows.map((row) => (
                    <tr key={row.memberId}>
                      <th scope="row">{row.memberName}</th>
                      {row.cells.map((cell) => (
                        <td className={cell.amountBdt > 0 ? "is-paid" : "is-empty"} key={cell.monthKey}>
                          {cell.amountBdt > 0 ? formatBdtAmount(cell.amountBdt) : "\u2014"}
                        </td>
                      ))}
                      <td>{row.paidMonths}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Month total</th>
                    {block.monthTotalsBdt.map((total, index) => (
                      <td key={block.months[index].key}>{total > 0 ? formatBdtAmount(total) : "\u2014"}</td>
                    ))}
                    <td>{block.rows.reduce((sum, row) => sum + row.paidMonths, 0)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ))
        )}
        <p className="report-note">
          {calendar.monthCount} month{calendar.monthCount === 1 ? "" : "s"} in scope across {calendar.blocks.length}{" "}
          block{calendar.blocks.length === 1 ? "" : "s"}. Approved contributions placed by month total{" "}
          {formatBdt(calendar.totalBdt)}.
        </p>
      </section>

      <section className="report-sheet">
        <div className="report-sheet__head">
          <h2 className="report-sheet__title">Ledger detail</h2>
          <p className="report-sheet__scope">
            Approved payments in date order for {masthead.ledgerRangeLabel}, oldest first, with a running total.
            {" "}
            {masthead.memberFilterLabel === "All members" ? "All members." : `Filtered to ${masthead.memberFilterLabel}.`}
          </p>
        </div>
        {ledger.groups.length === 0 ? (
          <p className="report-note">No approved payments match these filters.</p>
        ) : (
          <table className="report-table report-table--ledger">
            <caption>
              {ledger.totals.entryCount} approved entr{ledger.totals.entryCount === 1 ? "y" : "ies"} from{" "}
              {ledger.totals.memberCount} member{ledger.totals.memberCount === 1 ? "" : "s"}. Amounts in BDT.
            </caption>
            <colgroup>
              <col className="report-col--ledger-date" />
              <col className="report-col--ledger-member" />
              <col className="report-col--ledger-amount" />
              <col className="report-col--ledger-method" />
              <col className="report-col--ledger-source" />
              <col className="report-col--ledger-receipt" />
              <col className="report-col--ledger-running" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Member</th>
                <th scope="col" className="num">Amount</th>
                <th scope="col">Method</th>
                <th scope="col">Source</th>
                <th scope="col" className="num">Receipt</th>
                <th scope="col" className="num">Running total</th>
              </tr>
            </thead>
            {ledger.groups.map((group) => (
              <tbody className="report-month-group" key={group.monthKey}>
                <tr>
                  <th className="report-month-head" scope="rowgroup" colSpan={7}>
                    {group.label}
                    <span className="report-month-head__meta">
                      {group.entries.length} entr{group.entries.length === 1 ? "y" : "ies"} {"\u00b7"} subtotal{" "}
                      {formatBdt(group.subtotalBdt)} {"\u00b7"} running total {formatBdt(group.cumulativeBdt)}
                    </span>
                  </th>
                </tr>
                {group.entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatDate(entry.paymentDate)}</td>
                    <td>
                      <div className="report-ledger-cell">
                        <span>{entry.memberName}</span>
                        {entry.memberCode && <span className="report-ledger-cell__sub">{entry.memberCode}</span>}
                        {entry.notes && <span className="report-ledger-cell__sub">{entry.notes}</span>}
                      </div>
                    </td>
                    <td className="num">{formatBdt(entry.amountBdt)}</td>
                    <td>
                      <div className="report-ledger-cell">
                        <span>{entry.method || "Not set"}</span>
                        {entry.sentFromCountry && (
                          <span className="report-ledger-cell__sub">from {entry.sentFromCountry}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      {entry.sourceCurrency || entry.sourceAmount ? (
                        <div className="report-ledger-cell">
                          <span>
                            {entry.sourceCurrency ?? ""} {entry.sourceAmount ?? ""}
                          </span>
                          {entry.exchangeRate ? (
                            <span className="report-ledger-cell__sub">at {entry.exchangeRate}</span>
                          ) : null}
                        </div>
                      ) : (
                        "\u2014"
                      )}
                    </td>
                    <td className={entry.hasReceipt ? "report-receipt report-receipt--yes" : "report-receipt report-receipt--no"}>
                      {entry.hasReceipt ? "On file" : "\u2014"}
                    </td>
                    <td className="num">{formatBdt(entry.runningTotalBdt)}</td>
                  </tr>
                ))}
                <tr className="report-month-subtotal">
                  <th scope="row" colSpan={2}>{`${group.label} subtotal`}</th>
                  <td className="num">{formatBdt(group.subtotalBdt)}</td>
                  <td />
                  <td />
                  <td />
                  <td className="num">{formatBdt(group.cumulativeBdt)}</td>
                </tr>
              </tbody>
            ))}
            <tfoot>
              <tr>
                <th scope="row" colSpan={2}>{`Closing balance \u00b7 ${ledger.totals.entryCount} entries`}</th>
                <td className="num">{formatBdt(ledger.totals.totalBdt)}</td>
                <td />
                <td />
                <td />
                <td className="num">{formatBdt(ledger.totals.totalBdt)}</td>
              </tr>
            </tfoot>
          </table>
        )}
        <p className="report-ledger-footnote">
          Receipt column shows whether a payment proof is stored against the entry, not a file listing.
          {reconciliation.ledgerReconcilesToFund
            ? ` This ledger reconciles to the fund position of ${formatBdt(reconciliation.fundApprovedBdt)}.`
            : ` The ledger lists ${formatBdt(reconciliation.ledgerTotalBdt)} of the ${formatBdt(reconciliation.fundApprovedBdt)} approved to date; the rest falls outside the selected filters.`}
        </p>
      </section>
    </article>,
    document.body,
  );
}

/** Overdue money is flagged with the word "due" as well as a colour, never colour alone. */
function ReportBalance({ row }: { row: ReportModel["roster"]["rows"][number] }) {
  if (row.overdueMonths > 0) {
    return (
      <span className="report-balance report-balance--due">
        {formatBdt(row.remainingDueBdt)} due
        <span className="report-ledger-cell__sub">
          {row.overdueMonths} month{row.overdueMonths === 1 ? "" : "s"}
        </span>
      </span>
    );
  }
  if (row.advanceMonths > 0) {
    return (
      <span className="report-balance report-balance--clear">
        Advance
        <span className="report-ledger-cell__sub">
          {row.advanceMonths} month{row.advanceMonths === 1 ? "" : "s"}
        </span>
      </span>
    );
  }
  if (row.creditBdt > 0) {
    return (
      <span className="report-balance report-balance--clear">
        {formatBdt(row.creditBdt)} credit
        <span className="report-ledger-cell__sub">toward next month</span>
      </span>
    );
  }
  return <span className="report-balance report-balance--clear">Current</span>;
}

function buildReconciliationNote(model: ReportModel) {
  const { reconciliation, masthead } = model;
  const sentences: string[] = [];

  sentences.push(
    `Members listed account for ${formatBdt(reconciliation.rosterTotalBdt)} of the ${formatBdt(reconciliation.fundApprovedBdt)} approved to date.`,
  );

  if (reconciliation.unlistedMemberCount > 0) {
    sentences.push(
      `${formatBdt(reconciliation.unlistedTotalBdt)} is held for ${reconciliation.unlistedMemberCount} contributor${
        reconciliation.unlistedMemberCount === 1 ? "" : "s"
      } who ${reconciliation.unlistedMemberCount === 1 ? "is" : "are"} not currently an active member${
        reconciliation.unlistedMemberCount === 1 ? "" : "s"
      } and ${reconciliation.unlistedMemberCount === 1 ? "is" : "are"} therefore not listed above.`,
    );
  }

  if (masthead.monthFilterKey) {
    sentences.push(`Accounts are frozen at ${masthead.asOfLabel}; payments dated later are excluded.`);
  }

  if (masthead.memberFilterId !== REPORT_ALL) {
    sentences.push(`Member accounts are limited to ${masthead.memberFilterLabel}.`);
  }

  return sentences.join(" ");
}
