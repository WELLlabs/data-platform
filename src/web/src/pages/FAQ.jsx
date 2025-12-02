import React from "react";

function FAQ() {
  const faqItems = [
    {
      question: "What is the WELL Labs Open Data Portal?",
      answer:
        "The WELL Labs Open Data Portal is a centralized platform that serves as a source of truth for all datasets within the organization. It provides easy access to datasets, helping team members discover data that can be useful for their work.",
    },
    {
      question: "Who can access the portal?",
      answer:
        "The portal is accessible to all WELL Labs team members. Public datasets are available to everyone, while private datasets are restricted to members of the same organization.",
    },
    {
      question: "How do I upload a dataset?",
      answer:
        "To upload a dataset, you need to be signed in. Click on the 'Upload' button in the navigation bar or on the datasets page. You'll be guided through the process of providing dataset information and uploading your files.",
    },
    {
      question: "What file formats are supported?",
      answer:
        "The portal supports various file formats including CSV, JSON, Excel, and other common data formats. When uploading, you can specify the file format in the dataset metadata.",
    },
    {
      question: "What is the difference between public and private datasets?",
      answer:
        "Public datasets are visible to all users of the portal, while private datasets are only visible to members of the same organization. You can set the privacy level when creating or editing a dataset.",
    },
    {
      question: "How do I download a dataset?",
      answer:
        "You can download datasets by navigating to the dataset information page and clicking the download button. The download link will be provided for each file associated with the dataset.",
    },
    {
      question: "Can I edit or delete my uploaded datasets?",
      answer:
        "Yes, you can edit or delete datasets that you have created. Navigate to your dataset's information page to access these options. Note that deleting a dataset will permanently remove it from the portal.",
    },
    {
      question: "What information should I include when uploading a dataset?",
      answer:
        "When uploading a dataset, you should provide a clear title, description, tags for categorization, organization information, and any relevant metadata such as provenance, source, and citation information. This helps other users discover and understand your data.",
    },
    {
      question: "How do I search for datasets?",
      answer:
        "You can browse all available datasets on the Datasets page. The portal displays datasets sorted by creation date, with the most recent datasets appearing first. You can filter datasets based on your organization if you're signed in.",
    },
    {
      question: "What should I do if I encounter an error?",
      answer:
        "If you encounter any errors or issues while using the portal, please contact the WELL Labs support team. Include details about the error message and what you were trying to do when the error occurred.",
    },
  ];

  return (
    <div className="container py-5">
      <div className="row">
        <div className="col-12">
          <h2 className="section-title mb-4">Frequently Asked Questions</h2>
          <p className="lead text-muted mb-5">
            Find answers to common questions about the WELL Labs Open Data Portal.
          </p>
        </div>
      </div>

      <div className="row">
        <div className="col-lg-10 col-xl-8 mx-auto">
          <div className="accordion" id="faqAccordion">
            {faqItems.map((item, index) => (
              <div key={index} className="accordion-item mb-3 border-0 shadow-sm">
                <h3 className="accordion-header" id={`heading${index}`}>
                  <button
                    className="accordion-button collapsed"
                    type="button"
                    data-bs-toggle="collapse"
                    data-bs-target={`#collapse${index}`}
                    aria-expanded="false"
                    aria-controls={`collapse${index}`}
                    style={{
                      backgroundColor: "#ffffff",
                      color: "var(--deep-blue)",
                      fontWeight: "600",
                    }}
                  >
                    {item.question}
                  </button>
                </h3>
                <div
                  id={`collapse${index}`}
                  className="accordion-collapse collapse"
                  aria-labelledby={`heading${index}`}
                  data-bs-parent="#faqAccordion"
                >
                  <div
                    className="accordion-body"
                    style={{
                      backgroundColor: "var(--sea-foam)",
                      color: "var(--deep-blue)",
                    }}
                  >
                    {item.answer}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="row mt-5">
        <div className="col-12">
          <div
            className="card border-0 shadow-sm"
            style={{ backgroundColor: "var(--sea-foam)" }}
          >
            <div className="card-body p-4">
              <h5 className="card-title mb-3" style={{ color: "var(--deep-blue)" }}>
                <i className="bi bi-envelope me-2"></i>
                Still have questions?
              </h5>
              <p className="card-text text-muted mb-0">
                If you couldn't find the answer you're looking for, please contact the WELL Labs
                support team for assistance.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FAQ;

