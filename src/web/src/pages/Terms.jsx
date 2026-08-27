import React from "react";

function Terms() {
  const sections = [
    {
      title: "1. Acceptance of Terms",
      content: `By accessing and using the WELL Labs Open Data Portal (the "Portal"), you accept and agree to be bound by the terms and provision of this agreement. If you do not agree to abide by the above, please do not use this service.`,
    },
    {
      title: "2. Use License",
      content: `Permission is granted to temporarily access the materials on the Portal for personal, non-commercial transitory viewing only. This is the grant of a license, not a transfer of title, and under this license you may not:
- Modify or copy the materials
- Use the materials for any commercial purpose or for any public display (commercial or non-commercial)
- Attempt to decompile or reverse engineer any software contained on the Portal
- Remove any copyright or other proprietary notations from the materials
- Transfer the materials to another person or "mirror" the materials on any other server`,
    },
    {
      title: "3. Data Usage and Attribution",
      content: `When using datasets from the Portal, you must:
- Provide appropriate attribution to the data creators and WELL Labs
- Respect the license terms specified for each dataset
- Not use the data in a manner that could harm or misrepresent the original data creators
- Comply with any additional terms specified in the dataset metadata`,
    },
    {
      title: "4. User Accounts and Responsibilities",
      content: `Users are responsible for:
- Maintaining the confidentiality of their account credentials
- All activities that occur under their account
- Ensuring the accuracy of information provided when uploading datasets
- Respecting the privacy and intellectual property rights of others
- Complying with all applicable laws and regulations`,
    },
    {
      title: "5. Dataset Upload and Content",
      content: `When uploading datasets to the Portal, you agree that:
- You have the right to share the data you upload
- The data does not violate any third-party rights, including copyright, privacy, or other proprietary rights
- The data is accurate and not misleading
- You will provide complete and accurate metadata for your datasets
- You understand that public datasets will be accessible to all Portal users`,
    },
    {
      title: "6. Privacy and Data Protection",
      content: `The Portal respects user privacy and handles personal information in accordance with applicable data protection laws. Private datasets are only accessible to members of the same organization. Users should be aware that:
- Public datasets are accessible to all Portal users
- Dataset metadata may be visible to all users
- User activity on the Portal may be logged for security and improvement purposes`,
    },
    {
      title: "7. Intellectual Property",
      content: `The Portal and its original content, features, and functionality are owned by WELL Labs and are protected by international copyright, trademark, patent, trade secret, and other intellectual property laws. Dataset creators retain ownership of their uploaded datasets, subject to the license terms they specify.`,
    },
    {
      title: "8. Disclaimer",
      content: `The materials on the Portal are provided on an 'as is' basis. WELL Labs makes no warranties, expressed or implied, and hereby disclaims and negates all other warranties including, without limitation, implied warranties or conditions of merchantability, fitness for a particular purpose, or non-infringement of intellectual property or other violation of rights.`,
    },
    {
      title: "9. Limitations",
      content: `In no event shall WELL Labs or its suppliers be liable for any damages (including, without limitation, damages for loss of data or profit, or due to business interruption) arising out of the use or inability to use the materials on the Portal, even if WELL Labs or a WELL Labs authorized representative has been notified orally or in writing of the possibility of such damage.`,
    },
    {
      title: "10. Revisions and Errata",
      content: `The materials appearing on the Portal could include technical, typographical, or photographic errors. WELL Labs does not warrant that any of the materials on its Portal are accurate, complete, or current. WELL Labs may make changes to the materials contained on its Portal at any time without notice.`,
    },
    {
      title: "11. Links",
      content: `WELL Labs has not reviewed all of the sites linked to the Portal and is not responsible for the contents of any such linked site. The inclusion of any link does not imply endorsement by WELL Labs of the site. Use of any such linked website is at the user's own risk.`,
    },
    {
      title: "12. Modifications to Terms",
      content: `WELL Labs may revise these terms of service for its Portal at any time without notice. By using this Portal you are agreeing to be bound by the then current version of these terms of service.`,
    },
    {
      title: "13. Termination",
      content: `WELL Labs reserves the right to terminate or suspend access to the Portal immediately, without prior notice or liability, for any reason whatsoever, including without limitation if you breach the Terms. Upon termination, your right to use the Portal will immediately cease.`,
    },
    {
      title: "14. Governing Law",
      content: `These terms and conditions are governed by and construed in accordance with applicable laws, and you irrevocably submit to the exclusive jurisdiction of the courts in that location.`,
    },
  ];

  return (
    <div className="page">
      <div className="wrap" style={{ maxWidth: 740, padding: "48px 0 88px" }}>
        <span className="eyebrow">Legal</span>
        <h1 className="display" style={{ margin: "12px 0 14px" }}>
          Terms of usage
        </h1>
        <p className="lede">
          Please read these terms carefully before using the WELL Labs Open Data
          Portal.
        </p>

        <p className="mono-token" style={{ marginTop: 18, display: "inline-block" }}>
          Last updated:{" "}
          {new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>

        <div style={{ marginTop: 24 }}>
          {sections.map((section, index) => (
            <div className="sec" key={index}>
              <div className="sec-label">{section.title}</div>
              <div className="prose">
                <p style={{ whiteSpace: "pre-line" }}>{section.content}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="rail-card" style={{ marginTop: 28 }}>
          <div className="sec-label">Contact information</div>
          <div className="prose">
            <p>
              If you have any questions about these Terms of Usage, please
              contact the WELL Labs support team.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Terms;
