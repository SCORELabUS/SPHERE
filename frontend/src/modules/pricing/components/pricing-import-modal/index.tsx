import { motion } from 'framer-motion';
import FileUpload from '../../../core/components/file-upload-input';

interface PricingImportModalProps {
  pricingName: string;
  onImport: (file: File) => void;
  onClose: () => void;
}

export default function PricingImportModal({ pricingName, onImport, onClose }: PricingImportModalProps) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-50 flex cursor-pointer items-center justify-center bg-tp-ink/60 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 8 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-full max-w-[28rem] rounded-xl border border-tp-hairline bg-tp-canvas p-6 shadow-elevation-4"
        onClick={e => e.stopPropagation()}
      >
        <h2 className="mb-2 text-center font-display text-lg font-semibold text-tp-ink">Add new pricing version</h2>
        <p className="mb-4 text-center text-sm text-tp-steel">
          Upload a Pricing2Yaml file. The pricing name will be set to <span className="font-medium text-tp-ink">{pricingName}</span>.
        </p>
        <FileUpload
          onSubmit={onImport}
          submitButtonText="Upload Version"
          isDragActiveText="Drop the Pricing2Yaml file here"
          isNotDragActiveText="Drag and drop a Pricing2Yaml file here"
        />
      </motion.div>
    </motion.div>
  );
}
