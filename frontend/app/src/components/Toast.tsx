import { AnimatePresence, motion } from "motion/react";

interface ToastProps {
	message: string | null;
}

export function Toast({ message }: ToastProps) {
	return (
		<AnimatePresence>
			{message !== null && (
				<motion.div
					className="toast"
					role="status"
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					exit={{ opacity: 0, y: 20 }}
					transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
				>
					<span className="toast__dot" />
					<span className="toast__msg">{message}</span>
				</motion.div>
			)}
		</AnimatePresence>
	);
}
