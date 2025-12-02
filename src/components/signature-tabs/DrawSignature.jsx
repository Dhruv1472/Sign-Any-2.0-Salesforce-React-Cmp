import React, { useRef, useEffect, useState } from "react";
import "./DrawSignature.css";

/**
 * DrawSignature Component
 * Canvas-based signature drawing pad
 *
 * @param {Function} onChange - Callback when signature is drawn (receives base64 image)
 * @param {number} clearTrigger - Trigger to clear the canvas
 * @param {boolean} hidePen - If true, hide pen tool button
 * @param {boolean} hideEraser - If true, hide eraser tool button
 * @param {boolean} hideUndo - If true, hide undo button
 * @param {boolean} hideRedo - If true, hide redo button
 * @param {boolean} hideBrushSize - If true, hide brush size slider
 * @param {number} defaultPenSize - Default pen size (1-10)
 * @param {number} defaultEraseSize - Default eraser size (1-10)
 * @param {number} minBrushSize - Minimum brush size
 * @param {number} maxBrushSize - Maximum brush size
 */
const DrawSignature = ({ onChange, clearTrigger, hidePen = false, hideEraser = false, hideUndo = false, hideRedo = false, hideBrushSize = false, defaultPenSize = 2, defaultEraseSize = 10, minBrushSize = 1, maxBrushSize = 10 }) => {
    const canvasRef = useRef(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [isEmpty, setIsEmpty] = useState(true);
    const [tool, setTool] = useState("pen"); // 'pen' or 'erase'
    const [penSize, setPenSize] = useState(defaultPenSize);
    const [eraseSize, setEraseSize] = useState(defaultEraseSize);
    const [history, setHistory] = useState([]);
    const [historyStep, setHistoryStep] = useState(-1);
    const [lastPoint, setLastPoint] = useState(null);
    const [cursorPosition, setCursorPosition] = useState(null);

    const initializeCanvas = () => {
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
        setIsEmpty(true);

        // Notify parent that canvas was cleared
        if (onChange) {
            onChange(null);
        }
    };

    useEffect(() => {
        initializeCanvas();

        // Handle window resize
        const handleResize = () => {
            initializeCanvas();
        };

        window.addEventListener("resize", handleResize);

        return () => {
            window.removeEventListener("resize", handleResize);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

        setCursorPosition({ x, y });

        // Set style based on tool
        if (tool === "pen") {
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = penSize;
        } else {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = eraseSize * 5;
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(x, y);
        setLastPoint({ x, y });
        setIsDrawing(true);
    };

    const draw = (e) => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const rect = canvas.getBoundingClientRect();

        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        setCursorPosition({ x, y });

        if (!isDrawing) return;

        // Use quadratic curves for smooth lines
        if (lastPoint) {
            const midX = (lastPoint.x + x) / 2;
            const midY = (lastPoint.y + y) / 2;
            ctx.quadraticCurveTo(lastPoint.x, lastPoint.y, midX, midY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(midX, midY);
        }

        setLastPoint({ x, y });
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

            // Draw final point to complete the stroke
            if (lastPoint) {
                ctx.lineTo(lastPoint.x, lastPoint.y);
                ctx.stroke();
            }

            ctx.closePath();
            setIsDrawing(false);
            setLastPoint(null);
            saveToHistory();
        }
    };

    const handleMouseLeave = () => {
        setCursorPosition(null);
        stopDrawing();
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
        if (!canvasRef.current) return;
        const touch = e.touches[0];
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const ctx = canvas.getContext("2d");

        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        setCursorPosition({ x, y });

        // Set style based on tool
        if (tool === "pen") {
            ctx.strokeStyle = "#000000";
            ctx.lineWidth = penSize;
        } else {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = eraseSize * 5; // Multiply eraser size by 2x for better erasing
        }
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        ctx.beginPath();
        ctx.moveTo(x, y);
        setLastPoint({ x, y });
        setIsDrawing(true);
    };

    const handleTouchMove = (e) => {
        if (!canvasRef.current) return;

        const touch = e.touches[0];
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const rect = canvas.getBoundingClientRect();

        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;

        setCursorPosition({ x, y });

        if (!isDrawing) return;

        // Use quadratic curves for smooth lines on touch devices
        if (lastPoint) {
            const midX = (lastPoint.x + x) / 2;
            const midY = (lastPoint.y + y) / 2;
            ctx.quadraticCurveTo(lastPoint.x, lastPoint.y, midX, midY);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(midX, midY);
        }

        setLastPoint({ x, y });
        setIsEmpty(false);

        // Notify parent with canvas data
        if (onChange) {
            onChange(canvas.toDataURL("image/png"));
        }
    };

    const handleTouchEnd = () => {
        setCursorPosition(null);
        if (isDrawing && canvasRef.current) {
            const ctx = canvasRef.current.getContext("2d");

            // Draw final point to complete the stroke
            if (lastPoint) {
                ctx.lineTo(lastPoint.x, lastPoint.y);
                ctx.stroke();
            }

            ctx.closePath();
            setIsDrawing(false);
            setLastPoint(null);
            saveToHistory();
        }
    };

    return (
        <div className="draw-signature-container">
            <div className="draw-signature-toolbar">
                <div className="draw-signature-toolbar-section">
                    <div className="draw-signature-toolbar-left">
                        {/* Tool Selection */}
                        {!hidePen && (
                            <button className={`draw-toolbar-btn ${tool === "pen" ? "active" : ""}`} onClick={() => setTool("pen")} title="Pen">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M12.854.146a.5.5 0 0 0-.707 0L10.5 1.793 14.207 5.5l1.647-1.646a.5.5 0 0 0 0-.708l-3-3zm.646 6.061L9.793 2.5 3.293 9H3.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.207l6.5-6.5zm-7.468 7.468A.5.5 0 0 1 6 13.5V13h-.5a.5.5 0 0 1-.5-.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.5-.5V10h-.5a.499.499 0 0 1-.175-.032l-.179.178a.5.5 0 0 0-.11.168l-2 5a.5.5 0 0 0 .65.65l5-2a.5.5 0 0 0 .168-.11l.178-.178z" />
                                </svg>
                            </button>
                        )}
                        {!hideEraser && (
                            <button className={`draw-toolbar-btn ${tool === "erase" ? "active" : ""}`} onClick={() => setTool("erase")} title="Eraser">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                    <path d="M8.086 2.207a2 2 0 0 1 2.828 0l3.879 3.879a2 2 0 0 1 0 2.828l-5.5 5.5A2 2 0 0 1 7.879 15H5.12a2 2 0 0 1-1.414-.586l-2.5-2.5a2 2 0 0 1 0-2.828l6.879-6.879zm2.121.707a1 1 0 0 0-1.414 0L4.16 7.547l5.293 5.293 4.633-4.633a1 1 0 0 0 0-1.414l-3.879-3.879zM8.746 13.547 3.453 8.254 1.914 9.793a1 1 0 0 0 0 1.414l2.5 2.5a1 1 0 0 0 .707.293H7.88a1 1 0 0 0 .707-.293l.16-.16z" />
                                </svg>
                            </button>
                        )}
                    </div>

                    <div className="draw-signature-toolbar-right">
                        {!hideUndo && (
                            <button className="draw-toolbar-btn" onClick={handleUndo} disabled={historyStep <= 0} title="Undo">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                    <path fillRule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2v1z" />
                                    <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466z" />
                                </svg>
                            </button>
                        )}
                        {!hideRedo && (
                            <button className="draw-toolbar-btn" onClick={handleRedo} disabled={historyStep >= history.length - 1} title="Redo">
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                                    <path fillRule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z" />
                                    <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                {!hideBrushSize && (
                    <div className="draw-signature-toolbar-bottom">
                        <span>Brush Size</span>
                        <div className="draw-toolbar-range-container">
                            <input className="draw-toolbar-range" type="range" min={minBrushSize} max={maxBrushSize} value={tool === "pen" ? penSize : eraseSize} onChange={(e) => (tool === "pen" ? setPenSize(parseInt(e.target.value)) : setEraseSize(parseInt(e.target.value)))} />
                            <input className="draw-toolbar-range-val" type="number" min={minBrushSize} max={maxBrushSize} step={1} value={tool === "pen" ? penSize : eraseSize} onChange={(e) => (tool === "pen" ? setPenSize(parseInt(e.target.value)) : setEraseSize(parseInt(e.target.value)))} />
                        </div>
                    </div>
                )}

                {hidePen && hideEraser && hideUndo && hideRedo && hideBrushSize && <div className="empty-state-text">No customization options available for now!</div>}
            </div>

            <div className="draw-signature-canvas-wrapper">
                <canvas ref={canvasRef} className="draw-signature-canvas" style={{ cursor: tool === "erase" ? "none" : "crosshair" }} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={handleMouseLeave} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} />
                {isEmpty && <div className="draw-signature-placeholder">Draw your signature here</div>}
                {tool === "erase" && cursorPosition && (
                    <div
                        className="eraser-cursor"
                        style={{
                            left: `${cursorPosition.x}px`,
                            top: `${cursorPosition.y}px`,
                            width: `${eraseSize * 5}px`,
                            height: `${eraseSize * 5}px`,
                        }}
                    />
                )}
            </div>
        </div>
    );
};

export default DrawSignature;
