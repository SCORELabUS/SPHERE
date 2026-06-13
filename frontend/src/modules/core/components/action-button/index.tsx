import { motion } from "framer-motion";

export default function ActionButton({
  text,
  onClick,
  disabled = false,
  className = '',
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      whileHover={{ scale: !disabled ? 1.02 : 1 }}
      transition={{ duration: 0.3, ease: "easeInOut" }}
      className={`rounded-md cursor-pointer bg-tp-primary px-4 py-2 text-white disabled:cursor-not-allowed disabled:bg-tp-primary/50 ${className}`}
    >
      {text}
    </motion.button>
  );
}