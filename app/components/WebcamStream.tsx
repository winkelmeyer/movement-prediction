"use client";

import { useEffect, useRef, useState } from "react";

// Type definitions for MediaPipe Hands
interface HandLandmark {
	x: number;
	y: number;
	z?: number;
}

interface HandResults {
	multiHandLandmarks?: HandLandmark[][];
}

interface HandsConfig {
	locateFile?: (path: string, prefix?: string) => string;
}

interface HandsInterface {
	close(): Promise<void>;
	onResults(listener: (results: HandResults) => void): void;
	initialize(): Promise<void>;
	reset(): void;
	send(inputs: {
		image: HTMLVideoElement | HTMLImageElement | HTMLCanvasElement;
	}): Promise<void>;
	setOptions(options: {
		maxNumHands?: number;
		modelComplexity?: 0 | 1;
		minDetectionConfidence?: number;
		minTrackingConfidence?: number;
	}): void;
}

interface HandsConstructor {
	new (config?: HandsConfig): HandsInterface;
}

interface DangerZone {
	x: number;
	y: number;
	width: number;
	height: number;
}

export default function WebcamStream() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dangerZone, setDangerZone] = useState<DangerZone | null>(null);
	const [isDefiningZone, setIsDefiningZone] = useState(false);
	const [trackedItemName, setTrackedItemName] = useState<string>("");
	const [handInDangerZone, setHandInDangerZone] = useState(false);
	const streamRef = useRef<MediaStream | null>(null);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);
	const handsRef = useRef<HandsInterface | null>(null);
	const animationFrameRef = useRef<number | null>(null);
	const HandsClassRef = useRef<HandsConstructor | null>(null);
	const dragStartRef = useRef<{ x: number; y: number } | null>(null);
	const isDraggingRef = useRef(false);
	const dangerZoneRef = useRef<DangerZone | null>(null);

	useEffect(() => {
		return () => {
			// Cleanup on unmount
			if (streamRef.current) {
				for (const track of streamRef.current.getTracks()) {
					track.stop();
				}
			}
			if (intervalRef.current) {
				clearInterval(intervalRef.current);
			}
			if (animationFrameRef.current !== null) {
				cancelAnimationFrame(animationFrameRef.current);
			}
			if (handsRef.current) {
				handsRef.current.close();
			}
		};
	}, []);

	// Update danger zone ref when state changes
	useEffect(() => {
		dangerZoneRef.current = dangerZone;
	}, [dangerZone]);

	// Check if hand bounding box intersects with danger zone
	const checkHandInDangerZone = (
		handMinX: number,
		handMinY: number,
		handMaxX: number,
		handMaxY: number,
	): boolean => {
		const zone = dangerZoneRef.current;
		if (!zone) return false;

		// Check if hand bounding box overlaps with danger zone
		const overlaps = !(
			handMaxX < zone.x ||
			handMinX > zone.x + zone.width ||
			handMaxY < zone.y ||
			handMinY > zone.y + zone.height
		);

		return overlaps;
	};

	const drawHandBoundingBoxes = (results: HandResults) => {
		if (!overlayCanvasRef.current || !videoRef.current) return;

		const canvas = overlayCanvasRef.current;
		const ctx = canvas.getContext("2d");
		if (!ctx) return;

		// Clear previous drawings
		ctx.clearRect(0, 0, canvas.width, canvas.height);

		// Draw danger zone if defined
		const zone = dangerZoneRef.current;
		if (zone) {
			ctx.fillStyle = "rgba(255, 0, 0, 0.2)"; // Semi-transparent red
			ctx.fillRect(zone.x, zone.y, zone.width, zone.height);
			ctx.strokeStyle = "#ff0000"; // Red border
			ctx.lineWidth = 3;
			ctx.strokeRect(zone.x, zone.y, zone.width, zone.height);

			// Draw label for danger zone
			if (trackedItemName) {
				ctx.fillStyle = "#ffffff";
				ctx.font = "bold 16px Arial";
				ctx.fillText(`Danger Zone: ${trackedItemName}`, zone.x + 5, zone.y - 5);
			}
		}

		let anyHandInZone = false;

		if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
			for (const landmarks of results.multiHandLandmarks) {
				// Calculate bounding box from landmarks
				let minX = Number.POSITIVE_INFINITY;
				let minY = Number.POSITIVE_INFINITY;
				let maxX = Number.NEGATIVE_INFINITY;
				let maxY = Number.NEGATIVE_INFINITY;

				for (const landmark of landmarks) {
					const x = landmark.x * canvas.width;
					const y = landmark.y * canvas.height;
					minX = Math.min(minX, x);
					minY = Math.min(minY, y);
					maxX = Math.max(maxX, x);
					maxY = Math.max(maxY, y);
				}

				// Add padding to the bounding box
				const padding = 20;
				minX = Math.max(0, minX - padding);
				minY = Math.max(0, minY - padding);
				maxX = Math.min(canvas.width, maxX + padding);
				maxY = Math.min(canvas.height, maxY + padding);

				// Check if hand is in danger zone
				const inZone = checkHandInDangerZone(minX, minY, maxX, maxY);
				if (inZone) {
					anyHandInZone = true;
					console.log("Hand detected in danger zone!", {
						handBox: { minX, minY, maxX, maxY },
						dangerZone: zone,
					});
				}

				// Draw hand bounding box - red if in danger zone, green otherwise
				ctx.strokeStyle = inZone ? "#ff0000" : "#00ff00";
				ctx.lineWidth = inZone ? 4 : 3;
				ctx.strokeRect(minX, minY, maxX - minX, maxY - minY);

				// Draw warning text if in danger zone
				if (inZone) {
					ctx.fillStyle = "#ff0000";
					ctx.font = "bold 20px Arial";
					ctx.fillText("⚠️ DANGER!", minX, minY - 10);
				}
			}
		}

		// Update state - use functional update to ensure we have latest value
		setHandInDangerZone((prev) => {
			// Only update if value changed to avoid unnecessary re-renders
			if (prev !== anyHandInZone) {
				return anyHandInZone;
			}
			return prev;
		});
	};

	const startWebcam = async () => {
		try {
			setError(null);
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { width: 640, height: 480 },
			});

			streamRef.current = stream;

			if (videoRef.current && overlayCanvasRef.current) {
				videoRef.current.srcObject = stream;
				videoRef.current.play();

				// Load MediaPipe Hands dynamically
				const initHands = async () => {
					try {
						// Load MediaPipe Hands module
						// Since it uses global exports, we need to access it after import
						const handsModule = await import("@mediapipe/hands");

						// MediaPipe exports to global, so we need to wait a bit for it to initialize
						// Try accessing from module first, then from global
						let Hands: HandsConstructor | null = null;

						// Type-safe access to MediaPipe module
						const moduleWithHands = handsModule as unknown as {
							Hands?: HandsConstructor;
						};
						const windowWithHands = window as unknown as {
							Hands?: HandsConstructor;
						};

						// Check if it's exported from the module
						if (moduleWithHands.Hands) {
							Hands = moduleWithHands.Hands;
						} else if (windowWithHands.Hands) {
							// Check global object
							Hands = windowWithHands.Hands;
						} else {
							// Wait a bit for the module to initialize on global
							await new Promise((resolve) => setTimeout(resolve, 100));
							Hands = windowWithHands.Hands || moduleWithHands.Hands || null;
						}

						if (!Hands) {
							throw new Error("Hands class not found in MediaPipe module");
						}

						HandsClassRef.current = Hands;

						// Initialize MediaPipe Hands
						const hands = new Hands({
							locateFile: (file: string) => {
								return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
							},
						});

						hands.setOptions({
							maxNumHands: 2,
							modelComplexity: 1,
							minDetectionConfidence: 0.5,
							minTrackingConfidence: 0.5,
						});

						hands.onResults((results: HandResults) => {
							drawHandBoundingBoxes(results);
						});

						handsRef.current = hands;

						// Process frames using requestAnimationFrame
						const processFrame = async () => {
							if (
								videoRef.current &&
								handsRef.current &&
								!videoRef.current.paused &&
								videoRef.current.readyState >= videoRef.current.HAVE_METADATA
							) {
								await handsRef.current.send({ image: videoRef.current });
							}
							animationFrameRef.current = requestAnimationFrame(processFrame);
						};

						// Set overlay canvas dimensions and start processing frames once video is ready
						const videoElement = videoRef.current;
						if (videoElement) {
							videoElement.addEventListener("loadedmetadata", () => {
								if (overlayCanvasRef.current && videoElement) {
									overlayCanvasRef.current.width = videoElement.videoWidth;
									overlayCanvasRef.current.height = videoElement.videoHeight;
								}
								animationFrameRef.current = requestAnimationFrame(processFrame);
							});
						}
					} catch (err) {
						console.error("Error initializing MediaPipe Hands:", err);
						setError(
							"Failed to initialize hand tracking. Please refresh the page.",
						);
					}
				};

				initHands();
			}

			setIsStreaming(true);

			// Capture and send frames every 100ms (10 fps)
			intervalRef.current = setInterval(() => {
				captureAndSendFrame();
			}, 100);
		} catch (err) {
			setError("Failed to access webcam. Please check permissions.");
			console.error("Error accessing webcam:", err);
		}
	};

	const stopWebcam = () => {
		if (streamRef.current) {
			for (const track of streamRef.current.getTracks()) {
				track.stop();
			}
			streamRef.current = null;
		}

		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}

		if (animationFrameRef.current !== null) {
			cancelAnimationFrame(animationFrameRef.current);
			animationFrameRef.current = null;
		}

		if (handsRef.current) {
			handsRef.current.close();
			handsRef.current = null;
		}

		if (videoRef.current) {
			videoRef.current.srcObject = null;
		}

		if (overlayCanvasRef.current) {
			const ctx = overlayCanvasRef.current.getContext("2d");
			if (ctx) {
				ctx.clearRect(
					0,
					0,
					overlayCanvasRef.current.width,
					overlayCanvasRef.current.height,
				);
			}
		}

		setIsStreaming(false);
	};

	// Handle mouse events for defining danger zone
	const handleVideoMouseDown = (e: React.MouseEvent<HTMLVideoElement>) => {
		if (!isDefiningZone || !videoRef.current) return;

		const rect = videoRef.current.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		// Scale coordinates to video dimensions
		const scaleX = videoRef.current.videoWidth / rect.width;
		const scaleY = videoRef.current.videoHeight / rect.height;

		dragStartRef.current = {
			x: x * scaleX,
			y: y * scaleY,
		};
		isDraggingRef.current = true;
	};

	const handleVideoMouseMove = (e: React.MouseEvent<HTMLVideoElement>) => {
		if (
			!isDefiningZone ||
			!isDraggingRef.current ||
			!dragStartRef.current ||
			!videoRef.current
		)
			return;

		const rect = videoRef.current.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;

		// Scale coordinates to video dimensions
		const scaleX = videoRef.current.videoWidth / rect.width;
		const scaleY = videoRef.current.videoHeight / rect.height;

		const currentX = x * scaleX;
		const currentY = y * scaleY;

		// Update danger zone while dragging
		setDangerZone({
			x: Math.min(dragStartRef.current.x, currentX),
			y: Math.min(dragStartRef.current.y, currentY),
			width: Math.abs(currentX - dragStartRef.current.x),
			height: Math.abs(currentY - dragStartRef.current.y),
		});
	};

	const handleVideoMouseUp = () => {
		if (!isDefiningZone) return;
		isDraggingRef.current = false;
		setIsDefiningZone(false);
	};

	const startDefiningZone = () => {
		setIsDefiningZone(true);
		setDangerZone(null);
	};

	const clearDangerZone = () => {
		setDangerZone(null);
		setHandInDangerZone(false);
	};

	const captureAndSendFrame = () => {
		if (!videoRef.current || !canvasRef.current) return;

		const video = videoRef.current;
		const canvas = canvasRef.current;
		const ctx = canvas.getContext("2d");

		if (!ctx) return;

		// Set canvas dimensions to match video
		canvas.width = video.videoWidth;
		canvas.height = video.videoHeight;

		// Draw current video frame to canvas
		ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

		// Convert canvas to blob and send to server
		canvas.toBlob(
			async (blob) => {
				if (!blob) return;

				const formData = new FormData();
				formData.append("frame", blob, "frame.jpg");

				try {
					const response = await fetch("/api/stream", {
						method: "POST",
						body: formData,
					});

					if (!response.ok) {
						console.error("Failed to send frame:", response.statusText);
					}
				} catch (err) {
					console.error("Error sending frame:", err);
				}
			},
			"image/jpeg",
			0.8,
		); // JPEG quality 0.8
	};

	return (
		<div className="flex flex-col items-center gap-4 p-8">
			<h1 className="text-2xl font-bold">Webcam Stream</h1>

			<div className="relative">
				<video
					ref={videoRef}
					autoPlay
					playsInline
					muted
					className={`rounded-lg border-2 border-gray-300 bg-black ${
						isDefiningZone ? "cursor-crosshair" : ""
					}`}
					style={{ display: isStreaming ? "block" : "none" }}
					onMouseDown={handleVideoMouseDown}
					onMouseMove={handleVideoMouseMove}
					onMouseUp={handleVideoMouseUp}
					onMouseLeave={handleVideoMouseUp}
				/>
				<canvas
					ref={overlayCanvasRef}
					className="absolute top-0 left-0 rounded-lg pointer-events-none"
					style={{
						display: isStreaming ? "block" : "none",
						width: "100%",
						height: "100%",
					}}
				/>
				{!isStreaming && (
					<div className="flex h-[480px] w-[640px] items-center justify-center rounded-lg border-2 border-gray-300 bg-gray-100">
						<p className="text-gray-500">Webcam preview will appear here</p>
					</div>
				)}
				<canvas ref={canvasRef} className="hidden" />
			</div>

			{error && (
				<div className="rounded-lg bg-red-100 p-4 text-red-700">{error}</div>
			)}

			{handInDangerZone && dangerZone && (
				<div className="w-full rounded-lg bg-red-600 p-6 text-white font-bold text-xl animate-pulse shadow-lg border-4 border-red-800">
					<div className="flex items-center justify-center gap-2">
						<span className="text-3xl">⚠️</span>
						<span>WARNING: Hand detected in danger zone!</span>
						<span className="text-3xl">⚠️</span>
					</div>
					{trackedItemName && (
						<div className="text-center mt-2 text-lg">
							Item: {trackedItemName}
						</div>
					)}
				</div>
			)}

			<div className="flex flex-col gap-4 w-full max-w-2xl">
				{/* Item Name Input */}
				<div className="flex flex-col gap-2">
					<label htmlFor="itemName" className="text-sm font-medium">
						Tracked Item Name (e.g., Knife, Hot Surface, Machine):
					</label>
					<input
						id="itemName"
						type="text"
						value={trackedItemName}
						onChange={(e) => setTrackedItemName(e.target.value)}
						placeholder="Enter item name..."
						className="px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
					/>
				</div>

				{/* Control Buttons */}
				<div className="flex gap-4 flex-wrap">
					{!isStreaming ? (
						<button
							type="button"
							onClick={startWebcam}
							className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 transition-colors"
						>
							Start Streaming
						</button>
					) : (
						<>
							<button
								type="button"
								onClick={stopWebcam}
								className="rounded-lg bg-red-600 px-6 py-2 text-white hover:bg-red-700 transition-colors"
							>
								Stop Streaming
							</button>
							<button
								type="button"
								onClick={startDefiningZone}
								disabled={isDefiningZone}
								className="rounded-lg bg-yellow-600 px-6 py-2 text-white hover:bg-yellow-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
							>
								{isDefiningZone
									? "Drag on video to define zone..."
									: "Define Danger Zone"}
							</button>
							{dangerZone && (
								<button
									type="button"
									onClick={clearDangerZone}
									className="rounded-lg bg-gray-600 px-6 py-2 text-white hover:bg-gray-700 transition-colors"
								>
									Clear Danger Zone
								</button>
							)}
						</>
					)}
				</div>
			</div>

			{isStreaming && (
				<p className="text-sm text-gray-600">
					Streaming frames to /api/stream endpoint...
				</p>
			)}
		</div>
	);
}
