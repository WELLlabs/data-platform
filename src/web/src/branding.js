import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { branding_endpoint } from "./api/endpoints";

export const PRODUCT_NAME = "Data Platform";

const BrandingContext = createContext({
  hostName: "",
  productName: PRODUCT_NAME,
  brandLine: PRODUCT_NAME,
});

export function useBranding() {
  return useContext(BrandingContext);
}

function envHostName() {
  return String(
    process.env.REACT_APP_HOST_NAME ||
      process.env.REACT_APP_HOTS_NAME ||
      process.env.HOST_NAME ||
      ""
  ).trim();
}

export function BrandingProvider({ children }) {
  const [hostName, setHostName] = useState(envHostName());

  useEffect(() => {
    let active = true;
    fetch(branding_endpoint, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        const next = String(data?.host_name || "").trim();
        if (active && next) setHostName(next);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const value = useMemo(() => {
    const brandLine = hostName ? `${PRODUCT_NAME} by ${hostName}` : PRODUCT_NAME;
    return { hostName, productName: PRODUCT_NAME, brandLine };
  }, [hostName]);

  useEffect(() => {
    document.title = value.brandLine;
  }, [value.brandLine]);

  return (
    <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>
  );
}

const glyph = (
  <svg className="glyph" viewBox="0 0 24 28" fill="none" aria-hidden="true">
    <path d="M12 1C12 1 4 9.5 4 16.2C4 21 7.6 25 12 25C16.4 25 20 21 20 16.2C20 9.5 12 1 12 1Z" fill="#EAF4FA" stroke="#1769AA" strokeWidth="1.3"/>
    <path d="M12 1C12 1 4 9.5 4 16.2C4 21 7.6 25 12 25V1Z" fill="#0B1F33"/>
  </svg>
);

export function BrandLockup({ className = "brand", to = "/", onClick }) {
  const { hostName, productName } = useBranding();
  return (
    <Link className={className} to={to} aria-label={`${productName} home`} onClick={onClick}>
      {glyph}
      <span className="bwrap">
        <span className="bt">{productName}</span>
        {hostName ? <span className="bs">by {hostName}</span> : null}
      </span>
    </Link>
  );
}
