import React from "react";
import "./SomethingWentWrong.css";

const SomethingWentWrong = () => {
    return (
        <div className="error-container">
            <div className="error-card">
                <div className="error-animation">
                    <svg className="error-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                        <circle className="error-circle" cx="26" cy="26" r="25" fill="none" />
                        <path className="error-line error-line-1" fill="none" d="M16 16 L36 36" />
                        <path className="error-line error-line-2" fill="none" d="M36 16 L16 36" />
                    </svg>
                </div>

                <h1 className="error-title">Something Went Wrong</h1>
                <p className="error-message">We encountered an unexpected error while processing your request.</p>

                <div className="error-details">
                    <div className="detail-item-error">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 8V12M12 16H12.01M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#f44336" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Unable to Load Document</span>
                    </div>
                    <div className="detail-item-error">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M4 16L8.586 11.414C9.367 10.633 10.633 10.633 11.414 11.414L16 16M14 14L15.586 12.414C16.367 11.633 17.633 11.633 18.414 12.414L20 14M14 8H14.01M6 20H18C19.1046 20 20 19.1046 20 18V6C20 4.89543 19.1046 4 18 4H6C4.89543 4 4 4.89543 4 6V18C4 19.1046 4.89543 20 6 20Z" stroke="#f44336" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Document Not Available</span>
                    </div>
                    <div className="detail-item-error">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M12 6V12L16 14M22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2C17.5228 2 22 6.47715 22 12Z" stroke="#f44336" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span>Please Try Again Later</span>
                    </div>
                </div>

                <p className="error-note">
                    If the problem persists, please contact the person who sent you this document for assistance.
                </p>

                <div className="error-footer">
                    <p>Need help? Reach out to the document sender for support.</p>
                </div>
            </div>
        </div>
    );
};

export default SomethingWentWrong;
