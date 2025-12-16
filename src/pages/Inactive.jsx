import React from "react";
import "./Inactive.css";

const Inactive = () => {
    return (
        <div className="inactive-container">
            <div className="inactive-card">
                <div className="inactive-animation">
                    <svg className="inactive-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                        <circle className="inactive-circle" cx="26" cy="26" r="25" fill="none" />
                        <path className="inactive-line" fill="none" d="M14 26 L38 26" />
                    </svg>
                </div>

                <h1 className="inactive-title">Document Inactive</h1>
                <p className="inactive-message">This signature pad is currently inactive.</p>

                <div className="inactive-details">
                    <div className="detail-item-inactive">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 8V12M12 16H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#ff9800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Status: Inactive</span>
                    </div>
                    <div className="detail-item-inactive">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M9 12H15M9 16H15M17 21H7C5.89543 21 5 20.1046 5 19V5C5 3.89543 5.89543 3 7 3H12.5858C12.851 3 13.1054 3.10536 13.2929 3.29289L18.7071 8.70711C18.8946 8.89464 19 9.149 19 9.41421V19C19 20.1046 18.1046 21 17 21Z" stroke="#ff9800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Access Restricted</span>
                    </div>
                    <div className="detail-item-inactive">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M16 7C16 9.20914 14.2091 11 12 11C9.79086 11 8 9.20914 8 7C8 4.79086 9.79086 3 12 3C14.2091 3 16 4.79086 16 7Z" stroke="#ff9800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                            <path d="M12 14C8.13401 14 5 17.134 5 21H19C19 17.134 15.866 14 12 14Z" stroke="#ff9800" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Contact Administrator</span>
                    </div>
                </div>

                <p className="inactive-note">Please contact the administrator for further steps or to reactivate this document.</p>

                <div className="inactive-footer">
                    <p>For assistance, reach out to your system administrator or document sender.</p>
                </div>
            </div>
        </div>
    );
};

export default Inactive;
