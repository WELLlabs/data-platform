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
        "Public datasets are visible to everyone. Other levels restrict access to the creator, the organization, organization admins, or dataset owners.",
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
      question: "What do the dataset availability levels mean?",
      answer:
        "Public (0) is visible to everyone. Private (1) is creator-only. Organization (2) is visible to members of the dataset's organization. Admins (3) is visible to organization admins and dataset owners. Owners (4) is visible only to dataset owners (including the creator). Restricted levels require a private organization.",
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
    <div className="page">
      <div className="wrap" style={{ maxWidth: 740, padding: "48px 0 88px" }}>
        <span className="eyebrow">Help</span>
        <h1 className="display" style={{ margin: "12px 0 14px" }}>
          Frequently asked questions
        </h1>
        <p className="lede">
          Find answers to common questions about the WELL Labs Open Data Portal.
        </p>

        <div style={{ marginTop: 32 }}>
          {faqItems.map((item, index) => (
            <div className="sec" key={index}>
              <div className="sec-label">{item.question}</div>
              <div className="prose">
                <p>{item.answer}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rail-card" style={{ marginTop: 28 }}>
          <div className="sec-label">Still have questions?</div>
          <div className="prose">
            <p>
              If you couldn't find the answer you're looking for, please contact
              the WELL Labs support team for assistance.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FAQ;
