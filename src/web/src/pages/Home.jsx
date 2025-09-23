import React, { useEffect, useState } from "react";
import axios from "axios";

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

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await axios.get("/api/stats/data_count", { timeout: 6000 });
        // Expected response: { count: number }
        const value = res?.data?.count;
        if (isMounted) setDataCount(formatCount(value));
      } catch (e) {
        if (isMounted) setDataCount("000000+");
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
                Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer
                nec odio. Praesent libero.
              </p>
              <p className="lead mb-0">
                Sed cursus ante dapibus diam. Sed nisi. Nulla quis sem at nibh
                elementum imperdiet.
              </p>
              <p className="lead">
                Duis sagittis ipsum. Praesent mauris. Fusce nec tellus sed augue
                semper porta.
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
              {/*<div className="data-count-number">{dataCount}</div>*/}
            </div>
            <div className="col-md-8">
              {/*<div className="text-muted">
                Aggregated datasets spanning water, agriculture, and climate domains.
              </div>*/}
              <div className="data-count-number">{dataCount}</div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section className="container py-5">
        <div className="row g-4">
          <div className="col-md-4">
            <div className="card stat-card h-100">
              <div className="card-body">
                <h5 className="card-title">Recently Added Data</h5>
                {/* TODO: Replace below with data from API: /api/stats/recent */}
                <div className="stat-placeholder d-flex align-items-center justify-content-center text-muted">
                  Placeholder content
                </div>
              </div>
            </div>
          </div>
          <div className="col-md-4">
            <div className="card stat-card h-100">
              <div className="card-body">
                <h5 className="card-title">Top Organization</h5>
                {/* TODO: Replace below with data from API: /api/stats/top_orgs */}
                <div className="stat-placeholder d-flex align-items-center justify-content-center text-muted">
                  Placeholder content
                </div>
              </div>
            </div>
          </div>
          <div className="col-md-4">
            <div className="card stat-card h-100">
              <div className="card-body">
                <h5 className="card-title">Top Contributors</h5>
                {/* TODO: Replace below with data from API: /api/stats/top_contributors */}
                <div className="stat-placeholder d-flex align-items-center justify-content-center text-muted">
                  Placeholder content
                </div>
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


