import React, { useEffect, useState } from "react";
import axios from "axios";
import { Link } from "react-router-dom";
import { homepage_stats_endpoint } from "../api/endpoints";

function formatCount(value) {
  if (!value && value !== 0) return "000000+";
  try {
    const n = Number(value);
    if (Number.isNaN(n)) return "000000+";
    return `${n.toLocaleString()}+`;
  } catch {
    return "000000+";
  }
}

function Home() {
  const [dataCount, setDataCount] = useState("000000+");
  const [topOrganizations, setTopOrganizations] = useState([]);
  const [topContributors, setTopContributors] = useState([]);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await axios.get(homepage_stats_endpoint, { timeout: 6000 });
        const totalOpen = res?.data?.total_open_datasets;
        const orgs = Array.isArray(res?.data?.top_organizations)
          ? res.data.top_organizations
          : [];
        const contributors = Array.isArray(res?.data?.top_contributors)
          ? res.data.top_contributors
          : [];
        if (!isMounted) return;
        setDataCount(formatCount(totalOpen));
        setTopOrganizations(orgs);
        setTopContributors(contributors);
      } catch {
        if (isMounted) {
          setDataCount("000000+");
          setTopOrganizations([]);
          setTopContributors([]);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <div className="bg-wave">
      {/* Intro Section with background image */}
      <section
        className="hero-section"
        style={{
          backgroundImage: `url(${process.env.PUBLIC_URL + "/assets/images/hero-water.jpg"})`,
        }}
      >
        <div className="hero-overlay" />
        <div className="container hero-content position-relative">
          <div className="row">
            <div className="col-lg-9">
              <h1 className="display-4 hero-title mb-3">WELL Labs Open Data Portal</h1>
              <p className="lead mb-0">
                Welcome to the Open Data Portal by WELL Labs. The portal acts as a source of truth for all of the datasets within the organisation, providing easy access to all of them.
                This helps team members discover datasets that can be useful for their work.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Data Count Section */}
      <section className="container" style={{ marginTop: "-40px" }}>
        <div className="card data-count-card px-4 py-4 text-center">
          <div className="row align-items-center g-3">
            <div className="col-md-4">
              <h5 className="mb-1 text-uppercase text-muted">Total number of Open Data</h5>
            </div>
            <div className="col-md-8">
              <div className="data-count-number">{dataCount}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="container py-5">
        <div className="row g-4">
          <div className="col-12 col-lg-6">
            <div className="card stat-card h-100 w-100">
              <div className="card-body">
                <h5 className="card-title">Top Organizations</h5>
                {topOrganizations.length === 0 ? (
                  <div className="text-muted small">No data yet</div>
                ) : (
                  topOrganizations.map((org) => (
                    <div
                      key={org.organization_id}
                      className="row gx-2 align-items-center py-2 border-bottom border-light-subtle"
                    >
                      <div className="col">
                        <Link
                          className="text-decoration-none"
                          to={`/organisation?id=${encodeURIComponent(org.organization_id)}`}
                        >
                          {org.organization_name}
                        </Link>
                      </div>
                      <div className="col-auto text-muted">{org.contributions}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
          <div className="col-12 col-lg-6">
            <div className="card stat-card h-100 w-100">
              <div className="card-body">
                <h5 className="card-title">Top Contributors</h5>
                {topContributors.length === 0 ? (
                  <div className="text-muted small">No data yet</div>
                ) : (
                  topContributors.map((row) => (
                    <div
                      key={String(row.user_id)}
                      className="row gx-2 align-items-center py-2 border-bottom border-light-subtle"
                    >
                      <div className="col">
                        <Link
                          className="text-decoration-none"
                          to={`/profile?id=${encodeURIComponent(String(row.user_id))}`}
                        >
                          {row.full_name}
                        </Link>
                      </div>
                      <div className="col-auto text-muted">{row.contributions}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* More Info Section */}
      <section className="container pb-5">
        <h3 className="section-title mb-3">More</h3>
        <div className="d-flex flex-wrap gap-3 more-links">
          <a href="/faq">
            <i className="bi bi-question-circle" /> FAQ
          </a>
          <a href="/terms">
            <i className="bi bi-file-earmark-text" /> Terms of Usage
          </a>
          <a href="/api">
            <i className="bi bi-braces" /> API
          </a>
        </div>
      </section>
    </div>
  );
}

export default Home;
