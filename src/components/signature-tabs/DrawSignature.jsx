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
 * @param {number} canvasWidth - Canvas width in pixels
 * @param {number} canvasHeight - Canvas height in pixels
 */
const DrawSignature = ({ onChange, clearTrigger, hidePen = false, hideEraser = false, hideUndo = false, hideRedo = false, hideBrushSize = false, defaultPenSize = 2, defaultEraseSize = 10, minBrushSize = 1, maxBrushSize = 10, canvasWidth = 547, canvasHeight = 274 }) => {
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

        // Clear canvas with transparent background
        ctx.clearRect(0, 0, canvas.width, canvas.height);

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

    const handleSizeChange = (e) => {
        if (tool === "pen") {
            if (e.target.value >= minBrushSize && e.target.value <= maxBrushSize) {
                setPenSize(parseInt(e.target.value));
            }
        } else {
            if (e.target.value >= minBrushSize && e.target.value <= maxBrushSize) {
                setEraseSize(parseInt(e.target.value));
            }
        }
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
            setIsEmpty(false);

            // Notify parent with canvas data
            if (onChange) {
                onChange(canvas.toDataURL("image/png"));
            }

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
            ctx.clearRect(0, 0, canvas.width, canvas.height);

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
            ctx.lineWidth = eraseSize * 5;
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
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-pen-fill" viewBox="0 0 16 16">
                                    <path d="m13.498.795.149-.149a1.207 1.207 0 1 1 1.707 1.708l-.149.148a1.5 1.5 0 0 1-.059 2.059L4.854 14.854a.5.5 0 0 1-.233.131l-4 1a.5.5 0 0 1-.606-.606l1-4a.5.5 0 0 1 .131-.232l9.642-9.642a.5.5 0 0 0-.642.056L6.854 4.854a.5.5 0 1 1-.708-.708L9.44.854A1.5 1.5 0 0 1 11.5.796a1.5 1.5 0 0 1 1.998-.001" />
                                </svg>
                            </button>
                        )}
                        {!hideEraser && (
                            <button className={`draw-toolbar-btn ${tool === "erase" ? "active" : ""}`} onClick={() => setTool("erase")} title="Eraser">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-eraser-fill" viewBox="0 0 16 16">
                                    <path d="M8.086 2.207a2 2 0 0 1 2.828 0l3.879 3.879a2 2 0 0 1 0 2.828l-5.5 5.5A2 2 0 0 1 7.879 15H5.12a2 2 0 0 1-1.414-.586l-2.5-2.5a2 2 0 0 1 0-2.828zm.66 11.34L3.453 8.254 1.914 9.793a1 1 0 0 0 0 1.414l2.5 2.5a1 1 0 0 0 .707.293H7.88a1 1 0 0 0 .707-.293z" />
                                </svg>
                            </button>
                        )}
                    </div>

                    <div className="draw-signature-toolbar-right">
                        {!hideUndo && (
                            <button className="draw-toolbar-btn" onClick={handleUndo} disabled={historyStep <= 0} title="Undo">
                                <svg class="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 9h13a5 5 0 0 1 0 10H7M3 9l4-4M3 9l4 4" />
                                </svg>
                            </button>
                        )}
                        {!hideRedo && (
                            <button className="draw-toolbar-btn" onClick={handleRedo} disabled={historyStep >= history.length - 1} title="Redo">
                                <svg class="w-6 h-6 text-gray-800 dark:text-white" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none" viewBox="0 0 24 24">
                                    <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 9H8a5 5 0 0 0 0 10h9m4-10-4-4m4 4-4 4" />
                                </svg>
                            </button>
                        )}
                    </div>
                </div>

                {!hideBrushSize && (
                    <div className="draw-signature-toolbar-bottom">
                        <span>{tool === "pen" ? "Brush Size" : "Eraser Size"}</span>
                        <div className="draw-toolbar-range-container">
                            <input className="draw-toolbar-range" type="range" min={minBrushSize} max={maxBrushSize} value={tool === "pen" ? penSize : eraseSize} onChange={handleSizeChange} />
                            <input className="draw-toolbar-range-val" type="number" min={minBrushSize} max={maxBrushSize} step={1} value={tool === "pen" ? penSize : eraseSize} onChange={handleSizeChange} />
                        </div>
                    </div>
                )}

                {hidePen && hideEraser && hideUndo && hideRedo && hideBrushSize && <div className="empty-state-text">No customization options available for now!</div>}
            </div>

            <div className="draw-signature-canvas-wrapper" style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}>
                <canvas ref={canvasRef} width={canvasWidth} height={canvasHeight} className="draw-signature-canvas" style={{ cursor: tool === "erase" ? "none" : "crosshair" }} onMouseDown={startDrawing} onMouseMove={draw} onMouseUp={stopDrawing} onMouseLeave={handleMouseLeave} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd} />
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
