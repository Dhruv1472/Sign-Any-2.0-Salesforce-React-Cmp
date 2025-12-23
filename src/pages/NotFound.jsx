import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

const NotFound = () => {
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        // Extract search params from current location
        const searchParams = location.search;
        
        // Redirect to root page with preserved parameters
        navigate(`/${searchParams}`, { replace: true });
    }, [navigate, location]);

    // Return null since we're redirecting immediately
    return null;
};

export default NotFound;
