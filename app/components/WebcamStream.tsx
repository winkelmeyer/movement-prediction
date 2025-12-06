"use client";

import { useEffect, useRef, useState } from "react";

export default function WebcamStream() {
	const videoRef = useRef<HTMLVideoElement>(null);
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const [isStreaming, setIsStreaming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const intervalRef = useRef<NodeJS.Timeout | null>(null);

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
		};
	}, []);

	const startWebcam = async () => {
		try {
			setError(null);
			const stream = await navigator.mediaDevices.getUserMedia({
				video: { width: 640, height: 480 },
			});

			streamRef.current = stream;

			if (videoRef.current) {
				videoRef.current.srcObject = stream;
				videoRef.current.play();
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

		if (videoRef.current) {
			videoRef.current.srcObject = null;
		}

		setIsStreaming(false);
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
					className="rounded-lg border-2 border-gray-300 bg-black"
					style={{ display: isStreaming ? "block" : "none" }}
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

			<div className="flex gap-4">
				{!isStreaming ? (
					<button
						type="button"
						onClick={startWebcam}
						className="rounded-lg bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 transition-colors"
					>
						Start Streaming
					</button>
				) : (
					<button
						type="button"
						onClick={stopWebcam}
						className="rounded-lg bg-red-600 px-6 py-2 text-white hover:bg-red-700 transition-colors"
					>
						Stop Streaming
					</button>
				)}
			</div>

			{isStreaming && (
				<p className="text-sm text-gray-600">
					Streaming frames to /api/stream endpoint...
				</p>
			)}
		</div>
	);
}
