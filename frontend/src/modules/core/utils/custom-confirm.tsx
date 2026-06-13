import { createRoot } from 'react-dom/client';
import ConfirmModal from '../components/confirm-modal';

interface ConfirmOptions {
  danger?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}

function customConfirm(message: string, options: ConfirmOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const containerId = 'alert';
    let container = document.getElementById(containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = containerId;
      document.body.appendChild(container);
    }
    const root = createRoot(container);

    const cleanup = () => {
      root.unmount();
    };

    const handleConfirm = () => {
      cleanup();
      resolve();
    };

    const handleCancel = () => {
      cleanup();
      reject();
    };

    root.render(
      <ConfirmModal
        message={message}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
        danger={options.danger}
        confirmLabel={options.confirmLabel}
        cancelLabel={options.cancelLabel}
      />
    );
  });
}

export default customConfirm;
