import React, { useRef, useEffect, useState } from "react";
import "./DrawSignature.css";

/**
 * DrawSignature Component
 * Canvas-based signature drawing pad
 *
 * @param {Function} onChange - Callback when signature is drawn (receives base64 image)
 * @param {number} clearTrigger - Trigger to clear the canvas
 */
const DrawSignature = ({ onChange, clearTrigger }) => {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [isEmpty, setIsEmpty] = useState(true);
    const [tool, setTool] = useState("pen"); // 'pen' or 'erase'
    const [penSize, setPenSize] = useState(2);
    const [eraseSize, setEraseSize] = useState(10);
    const [history, setHistory] = useState([]);
    const [historyStep, setHistoryStep] = useState(-1);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");

        // Set canvas size
        canvas.width = canvas.offsetWidth;
        canvas.height = canvas.offsetHeight;

        // Set drawing styles
        ctx.strokeStyle = "#000000";
        ctx.lineWidth = 2;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Clear canvas
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Save initial state
        const imageData = canvas.toDataURL("image/png");
        setHistory([imageData]);
        setHistoryStep(0);
    }, []);

    const saveToHistory = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const imageData = canvas.toDataURL("image/png");
        setHistory((prev) => {
            const newHistory = prev.slice(0, historyStep + 1);
            return [...newHistory, imageData];
        });
        setHistoryStep((prev) => prev + 1);
    };

    const restoreFromHistory = (step) => {
        const canvas = canvasRef.current;
        if (!canvas || !history[step]) return;

        const ctx = canvas.getContext("2d");
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0);

            // Check if canvas is empty
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const pixels = imageData.data;
            let hasContent = false;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3] !== 0) {
                    hasContent = true;
                    break;
                }
            }
            setIsEmpty(!hasContent);

            if (onChange) {
                onChange(hasContent ? canvas.toDataURL("image/png") : null);
            }
        };
        img.src = history[step];
    };

    const handleUndo = () => {
        if (historyStep > 0) {
            const newStep = historyStep - 1;
            setHistoryStep(newStep);
            restoreFromHistory(newStep);
        }
    };

    const handleRedo = () => {
        if (historyStep < history.length - 1) {
            const newStep = historyStep + 1;
            setHistoryStep(newStep);
            restoreFromHistory(newStep);
        }
    };

    const startDrawing = (e) => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const rect = canvas.getBoundingClientRect();

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        // Set style based on tool
        if (tool === "pen") {
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = penSize;
        } else {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = eraseSize;
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(x, y);
        setIsDrawing(true);
    };

    const draw = (e) => {
        if (!isDrawing) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const rect = canvas.getBoundingClientRect();

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        ctx.lineTo(x, y);
        ctx.stroke();

        setIsEmpty(false);

        // Notify parent with canvas data
        if (onChange) {
            onChange(canvas.toDataURL("image/png"));
        }
    };

    const stopDrawing = () => {
        if (isDrawing) {
            const canvas = canvasRef.current;
            const ctx = canvas.getContext("2d");
            ctx.closePath();
            setIsDrawing(false);
            saveToHistory();
        }
    };

    // Clear canvas when clearTrigger changes
    useEffect(() => {
        if (clearTrigger > 0) {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext("2d");
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            setIsEmpty(true);

            // Reset history
            const imageData = canvas.toDataURL("image/png");
            setHistory([imageData]);
            setHistoryStep(0);
        }
    }, [clearTrigger]);

    // Touch events for mobile
    const handleTouchStart = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent("mousedown", {
            clientX: touch.clientX,
            clientY: touch.clientY,
        });
        canvasRef.current.dispatchEvent(mouseEvent);
    };

    const handleTouchMove = (e) => {
        e.preventDefault();
        const touch = e.touches[0];
        const mouseEvent = new MouseEvent("mousemove", {
            clientX: touch.clientX,
            clientY: touch.clientY,
        });
        canvasRef.current.dispatchEvent(mouseEvent);
    };

    const handleTouchEnd = (e) => {
        e.preventDefault();
        const mouseEvent = new MouseEvent("mouseup", {});
        canvasRef.current.dispatchEvent(mouseEvent);
    };

    return (
        <div className="draw-signature-container">
            <div className="draw-signature-toolbar">
                <div className="draw-signature-toolbar-left">
                    {/* Tool Selection */}
                    <button className={`draw-toolbar-btn ${tool === "pen" ? "active" : ""}`} onClick={() => setTool("pen")} title="Pen">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z" />
                        </svg>
                    </button>
                    <button className={`draw-toolbar-btn ${tool === "erase" ? "active" : ""}`} onClick={() => setTool("erase")} title="Eraser">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path d="M8.086 2.207a2 2 0 0 1 2.828 0l3.879 3.879a2 2 0 0 1 0 2.828l-5.5 5.5A2 2 0 0 1 7.879 15H5.12a2 2 0 0 1-1.414-.586l-2.5-2.5a2 2 0 0 1 0-2.828l6.879-6.879zm2.121.707a1 1 0 0 0-1.414 0L4.16 7.547l5.293 5.293 4.633-4.633a1 1 0 0 0 0-1.414l-3.879-3.879zM8.746 13.547 3.453 8.254 1.914 9.793a1 1 0 0 0 0 1.414l2.5 2.5a1 1 0 0 0 .707.293H7.88a1 1 0 0 0 .707-.293l.16-.16z" />
                        </svg>
                    </button>

                    <div className="draw-toolbar-divider"></div>

                    {/* Brush Size Selection */}
                    <div className="draw-toolbar-size-group">
                        <button className={`draw-toolbar-size-btn ${(tool === "pen" ? penSize === 2 : eraseSize === 8) ? "active" : ""}`} onClick={() => (tool === "pen" ? setPenSize(2) : setEraseSize(8))} title="Small">
                            <div className="size-indicator size-small"></div>
                        </button>
                        <button className={`draw-toolbar-size-btn ${(tool === "pen" ? penSize === 5 : eraseSize === 10) ? "active" : ""}`} onClick={() => (tool === "pen" ? setPenSize(5) : setEraseSize(10))} title="Medium">
                            <div className="size-indicator size-medium"></div>
                        </button>
                        <button className={`draw-toolbar-size-btn ${(tool === "pen" ? penSize === 8 : eraseSize === 12) ? "active" : ""}`} onClick={() => (tool === "pen" ? setPenSize(8) : setEraseSize(12))} title="Large">
                            <div className="size-indicator size-large"></div>
                        </button>
                    </div>
                </div>

                <div className="draw-signature-toolbar-right">
                    <button className="draw-toolbar-btn" onClick={handleUndo} disabled={historyStep <= 0} title="Undo">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path fillRule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z" />
                            <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z" />
                        </svg>
                    </button>
                    <button className="draw-toolbar-btn" onClick={handleRedo} disabled={historyStep >= history.length - 1} title="Redo">
                        <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                            <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z" />
                            <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
                        </svg>
                    </button>
                </div>
            </div>

            <div className="draw-signature-canvas-wrapper">
                <canvas ref={canvasRef} className="draw-signature-canvas" onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={stopDrawing} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} />
                {isEmpty && <div className="draw-signature-placeholder">Draw your signature here</div>}
            </div>
        </div>
    );
};

export default DrawSignature;
