import React from "react";
import Ic from "./Icons";

export const PAGE_SIZE_OPTIONS = [10, 20, 50];

// Page numbers to show: first/last, current ±1, with "…" gaps.
export function pageList(current, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  let nums;
  if (current <= 4) nums = [1, 2, 3, 4, 5, totalPages];
  else if (current >= totalPages - 3)
    nums = [1, totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  else nums = [1, current - 1, current, current + 1, totalPages];
  const out = [];
  nums.forEach((n, i) => {
    if (i && n - nums[i - 1] > 1) out.push("gap-" + n);
    out.push(n);
  });
  return out;
}

/**
 * Shared pagination bar used across the project.
 *
 * page            current page (1-based)
 * pageSize        records per page
 * total           total matching records (null if unknown; falls back to hasMore)
 * hasMore         used only when total is unknown
 * onPageChange    (page) => void
 * onPageSizeChange (size) => void; omit to hide the page-size picker
 * noun            label used in the summary line ("dataset" -> "datasets")
 */
export default function Pagination({
  page,
  pageSize,
  total = null,
  hasMore = false,
  loading = false,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
  noun = "record",
  itemsOnPage,
  className = "",
}) {
  const known = typeof total === "number" && Number.isFinite(total);
  if (known && total === 0) return null;

  const totalPages = known ? Math.max(1, Math.ceil(total / pageSize)) : null;
  const canPrev = page > 1;
  const canNext = known ? page < totalPages : hasMore;
  const go = (p) => {
    if (loading || p === page || p < 1 || (totalPages && p > totalPages)) return;
    onPageChange(p);
  };

  const first = (page - 1) * pageSize + 1;
  const last = known
    ? Math.min(page * pageSize, total)
    : (page - 1) * pageSize + (itemsOnPage ?? pageSize);
  const plural = (n) => `${noun}${n === 1 ? "" : "s"}`;

  return (
    <nav className={"pager " + className} aria-label="Pagination">
      <p className="pager-info">
        {known ? (
          <>Showing <b>{first}–{last}</b> of <b>{total}</b> {plural(total)}</>
        ) : (
          <>Page <b>{page}</b></>
        )}
        <span className="pager-sep">·</span>{pageSize} per page
        {known && (
          <>
            <span className="pager-sep">·</span>Page <b>{page}</b> of <b>{totalPages}</b>
            <span className="pager-sep">·</span>
            {/* {totalPages - page > 0
              ? <><b>{totalPages - page}</b> more page{totalPages - page === 1 ? "" : "s"}</>
              : "Last page"} */}
          </>
        )}
      </p>
      <div className="pager-pill">
        <button
          type="button"
          className="pg-arrow"
          onClick={() => go(page - 1)}
          disabled={!canPrev || loading}
          aria-label="Previous page"
        >
          <Ic name="chevLeft" size={16} sw={2.2} />
        </button>

        {known ? (
          pageList(page, totalPages).map((n) =>
            typeof n === "string" ? (
              <span className="pg-gap" key={n} aria-hidden="true">•••</span>
            ) : (
              <button
                type="button"
                key={n}
                className={"pg-num" + (n === page ? " active" : "")}
                aria-current={n === page ? "page" : undefined}
                onClick={() => go(n)}
                disabled={loading && n !== page}
              >
                {n}
              </button>
            )
          )
        ) : (
          <button type="button" className="pg-num active" aria-current="page">{page}</button>
        )}

        <button
          type="button"
          className="pg-arrow"
          onClick={() => canNext && go(page + 1)}
          disabled={!canNext || loading}
          aria-label="Next page"
        >
          <Ic name="chevLeft" size={16} sw={2.2} style={{ transform: "rotate(180deg)" }} />
        </button>

        {onPageSizeChange && (
          <label className="pg-size">
            <span className="sr-only">Records per page</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              disabled={loading}
            >
              {pageSizeOptions.map((n) => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </select>
            <Ic name="chev" size={15} sw={2.2} />
          </label>
        )}
      </div>

    </nav>
  );
}
