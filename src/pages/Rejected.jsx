import React from 'react';
import './Rejected.css';

const Rejected = () => {
    return (
        <div className="rejected-container">
            <div className="rejected-card">
                <div className="rejected-animation">
                    <svg className="reject-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52">
                        <circle className="reject-circle" cx="26" cy="26" r="25" fill="none"/>
                        <path className="reject-cross reject-cross-left" fill="none" d="M16 16 L36 36"/>
                        <path className="reject-cross reject-cross-right" fill="none" d="M36 16 L16 36"/>
                    </svg>
                </div>

                <h1 className="rejected-title">Document Rejected</h1>
                <p className="rejected-message">
                    You have rejected this document.
                </p>
                
                <div className="rejected-details">
                    <div className="detail-item-rejected">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M10 14L12 12M12 12L14 10M12 12L10 10M12 12L14 14M21 12C21 16.9706 16.9706 21 12 21C7.02944 21 3 16.9706 3 12C3 7.02944 7.02944 3 12 3C16.9706 3 21 7.02944 21 12Z" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span>Document Rejected</span>
                    </div>
                    <div className="detail-item-rejected">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M9 12H15M9 16H15M17 21H7C5.89543 21 5 20.1046 5 19V5C5 3.89543 5.89543 3 7 3H12.5858C12.851 3 13.1054 3.10536 13.2929 3.29289L18.7071 8.70711C18.8946 8.89464 19 9.149 19 9.41421V19C19 20.1046 18.1046 21 17 21Z" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span>Status Updated</span>
                    </div>
                    <div className="detail-item-rejected">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <path d="M3 8L10.89 13.26C11.2187 13.4793 11.6049 13.5963 12 13.5963C12.3951 13.5963 12.7813 13.4793 13.11 13.26L21 8M5 19H19C19.5304 19 20.0391 18.7893 20.4142 18.4142C20.7893 18.0391 21 17.5304 21 17V7C21 6.46957 20.7893 5.96086 20.4142 5.58579C20.0391 5.21071 19.5304 5 19 5H5C4.46957 5 3.96086 5.21071 3.58579 5.58579C3.21071 5.96086 3 6.46957 3 7V17C3 17.5304 3.21071 18.0391 3.58579 18.4142C3.96086 18.7893 4.46957 19 5 19Z" stroke="#d32f2f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span>Notification Sent</span>
                    </div>
                </div>

                <p className="rejected-note">
                    The document sender has been notified of your rejection. They may contact you for further clarification if needed.
                </p>

                <div className="rejected-footer">
                    <p>If you have any questions, please contact the document sender.</p>
                </div>
            </div>
        </div>
    );
};

export default Rejected;
