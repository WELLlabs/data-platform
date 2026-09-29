import React from "react";
import Ic from "./Icons";

// 1 -> "1st", 2 -> "2nd", 11 -> "11th", etc.
export const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

// Medal treatment for the top three positions.
export const MEDAL = {
  1: { cls: "rank-1", tone: "gold", label: "1st place", icon: "trophy" },
  2: { cls: "rank-2", tone: "silver", label: "2nd place", icon: "medal" },
  3: { cls: "rank-3", tone: "bronze", label: "3rd place", icon: "medal" },
};

export function RankRow({ rank, name, contributions, delay = 0 }) {
  const m = MEDAL[rank];
  const count =
    typeof contributions === "number"
      ? contributions.toLocaleString()
      : contributions ?? "—";
  return (
    <div
      className={"rank-row" + (m ? " " + m.cls : "")}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="rank-num">{ordinal(rank)}</span>
      <div className="rank-body">
        <b>
          <span className="rank-name">{name}</span>
          {m && (
            <span className={"badge place " + m.tone}>
              <Ic name={m.icon} size={12} sw={2} />
              {m.label}
            </span>
          )}
        </b>
        <span>
          {count} contribution{count === 1 || count === "1" ? "" : "s"}
        </span>
      </div>
    </div>
  );
}
