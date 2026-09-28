import React, { useState, useRef, useEffect } from "react";

function HelpTooltip({ text, id }) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipRef = useRef(null);
  const buttonRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        tooltipRef.current &&
        buttonRef.current &&
        !tooltipRef.current.contains(event.target) &&
        !buttonRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Don't render if text is empty
  if (!text || (typeof text === 'string' && text.trim() === "")) {
    return null;
  }

  return (
    <span className="position-relative d-inline-block ms-2">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn-link p-0 border-0 text-secondary"
        style={{
          fontSize: "0.875rem",
          lineHeight: "1",
          textDecoration: "none",
          cursor: "pointer",
        }}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        aria-label="Help"
        aria-describedby={id}
      >
        <i className="bi bi-question-circle"></i>
      </button>
      {isOpen && (
        <div
          ref={tooltipRef}
          id={id}
          className="position-absolute bg-light border rounded shadow-sm p-2"
          style={{
            top: "100%",
            left: "0",
            marginTop: "0.25rem",
            minWidth: "200px",
            maxWidth: "300px",
            zIndex: 1050,
            fontSize: "0.875rem",
            color: "#333",
            whiteSpace: typeof text === 'string' ? "pre-line" : "normal",
          }}
          role="tooltip"
        >
          {text}
        </div>
      )}
    </span>
  );
}

export default HelpTooltip;

