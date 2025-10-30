import React, { useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";

function DatasetSuccess() {
  const navigate = useNavigate();
  const location = useLocation();

  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const dataParam = params.get("data");

  useEffect(() => {
    if (!dataParam) {
      navigate("/signin");
    }
  }, [dataParam, navigate]);

  if (!dataParam) return null;

  let payload = null;
  try {
    payload = JSON.parse(decodeURIComponent(dataParam));
  } catch (e) {
    payload = null;
  }

  if (!payload) {
    return (
      <div className="container py-5">
        <h4>Dataset successfully created.</h4>
        <p>Unable to parse dataset details.</p>
      </div>
    );
  }

  return (
    <div className="container py-5">
      <h4 className="mb-3">Dataset successfully created.</h4>

      <div className="row">
        <div className="col-md-6">
          <h6>Dataset</h6>
          <pre className="bg-light p-3 rounded" style={{ whiteSpace: 'pre-wrap' }}>
{JSON.stringify(payload.dataset, null, 2)}
          </pre>
        </div>
        <div className="col-md-6">
          <h6>File</h6>
          <pre className="bg-light p-3 rounded" style={{ whiteSpace: 'pre-wrap' }}>
{JSON.stringify(payload.file, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default DatasetSuccess;


