import { motion } from 'framer-motion';
import { FaXmark } from 'react-icons/fa6';

export function SidePanel({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode;
}) {
  return (
    <>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <motion.div initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        className="fixed right-0 top-0 z-50 flex h-full w-[360px] flex-col border-l border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">{title}</h3>
          <button type="button" onClick={onClose}
            className="cursor-pointer rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
          ><FaXmark className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        <div className="border-t border-slate-200 px-5 py-4 dark:border-slate-700">{footer}</div>
      </motion.div>
    </>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</label>
      {children}
    </div>
  );
}
